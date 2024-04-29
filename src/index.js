const { io } = require("socket.io-client");
const { v4: uuidv4 } = require("uuid");
const { HyperProcess } = require('./message');

const config = {
  cookie: '',
  rProxy: '',
};

const getCookie = config => {
  const cookies = {}, cookieArr = config.cookie.split(/;\s?/gi).filter(prop => !/^(path|expires|domain|HttpOnly|Secure|SameSite)[=;]*/i.test(prop));
  for (const cookie of cookieArr) {
    const divide = cookie.split(/^(.*?)=\s*(.*)/);
    if (1 === divide.length) {
      continue;
    }
    const cookieName = divide[1], cookieVal = divide[2];
    cookies[cookieName] = cookieVal;
  }
  return Object.keys(cookies).map((name => `${name}=${cookies[name]}`)).join('; ').trim();
};

async function handleRequest(request) {
  if ('OPTIONS' === request.method) {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
      }
    });
  }

  if ('GET' === request.method && /\/v1\/models/.test(request.url)) {
    return new Response(JSON.stringify({
      data: [{ id: 'claude-3-opus-default' }]
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if ('POST' === request.method && /\/v1\/(messages|chat\/completions)/.test(request.url)) {
    const oaiAPI = request.url.includes('/v1/chat/completions');

    const abortController = new AbortController();
    const { signal } = abortController;

    signal.addEventListener('abort', () => {
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    });

    const jsonBody = await request.json();
    const traceId = uuidv4();
    const pplxConfig = Object.assign({}, config);

    let { prompt, log } = HyperProcess(jsonBody.system, jsonBody.messages);

    let match;
    if ((match = /\s*pplxConfig: *({[^{}]*?(?:"params": *{[^{}]*?})?[^{}]*?})\s*/s.exec(prompt))) {
      try {
        Object.assign(pplxConfig, JSON.parse(match[1]));
        prompt = prompt.replace(match[0], '\n\n');
      } catch { }
    }

    const Cookie = getCookie(pplxConfig);

    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    if (jsonBody.stream) {
      writer.write(encoder.encode(
        createEvent('message_start', oaiAPI ? {
          choices: [{
            index: 0,
            delta: {
              role: 'assistant',
              content: ''
            },
            logprobs: null,
            finish_reason: null
          }]
        } : {
          type: 'message_start',
          message: {
            id: traceId,
            type: 'message',
            role: 'assistant',
            content: [],
            model: pplxConfig.params.selectedAIModel,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 8, output_tokens: 1 },
          },
        }, oaiAPI)
      ));
      !oaiAPI && writer.write(encoder.encode(createEvent('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })));
      !oaiAPI && writer.write(encoder.encode(createEvent('ping', { type: 'ping' })));
    }

    let completionAll = '';
    let stop_flag = false;
    let stop_reason;
    let stop_sequence;
    const stops = (jsonBody.stop_sequence || jsonBody.stop)?.filter(item => item !== '\n\nHuman:' && item !== '\n\nAssistant:');

    var socket = io(pplxConfig.rProxy || "wss://www.perplexity.ai/", {
      auth: {
        jwt: "anonymous-ask-user",
      },
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 999,
      transports: ["websocket"],
      path: "/socket.io",
      hostname: "www.perplexity.ai",
      secure: true,
      port: "443",
      extraHeaders: {
        Cookie,
        "User-Agent": 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: "*/*",
        priority: "u=1, i",
        Referer: "https://www.perplexity.ai/",
      },
    });

    socket.on("connect", function () {
      console.log(" > [Connected]");
      socket
        .emitWithAck("perplexity_ask", prompt, {
          "version": "2.9",
          "source": "default",
          "attachments": [],
          "language": "en-GB",
          "timezone": "Europe/London",
          "search_focus": "writing",
          "frontend_uuid": uuidv4(),
          "mode": "concise",
          "is_related_query": false,
          "is_default_related_query": false,
          "visitor_id": uuidv4(),
          "frontend_context_uuid": uuidv4(),
          "prompt_source": "user",
          "query_source": "home"
        })
        .then((response) => {
          console.log(response);
          sendData();
        });
    });
    socket.onAny((event, ...args) => {
      console.log(`got ${event}`);
    });
    socket.on("query_progress", (data) => {
      if (data.text) {
        var text = JSON.parse(data.text)
        var chunk = text.chunks[text.chunks.length - 1];
        if (chunk) {
          sendData(chunk);
        }
      }
    });
    socket.on("disconnect", function () {
      console.log(" > [Disconnected]");
    });
    socket.on("error", (error) => {
      console.log(error);
    });
    socket.on("connect_error", function (error) {
      if (error.description && error.description == 403) {
        console.log(" > [Error] 403 Forbidden");
      }
      console.log(error);
    });

    if (jsonBody.stream) {
      return new Response(stream.readable, {
        headers: {
          'Content-Type': 'text/event-stream;charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      });
    } else {
      await waitForStop();
      return new Response(JSON.stringify(oaiAPI ? {
        choices: [{
          finish_reason: 'stop',
          index: 0,
          message: {
            content: completionAll,
            role: 'assistant'
          },
          logprobs: null
        }]
      } : {
        id: traceId,
        type: 'message',
        role: 'assistant',
        model: pplxConfig.params.selectedAIModel,
        stop_sequence: stop_sequence || null,
        usage: { input_tokens: 0, output_tokens: 0 },
        content: [{ type: 'text', text: completionAll }],
        stop_reason: stop_reason || 'end_turn'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    function waitForStop() {
      return new Promise(resolve => {
        const interval = setInterval(() => {
          if (stop_flag) {
            clearInterval(interval);
            resolve();
          }
        }, 100);
      });
    }

    function sendData(data) {
      const end = 'string' != typeof data;
      if (jsonBody.stream) {
        if (end) {
          if (oaiAPI) {
            writer.write(encoder.encode(createEvent(null, {
              choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: 'stop' }]
            }, oaiAPI)));
            writer.write(encoder.encode('data: [DONE]\n\n'));
          } else {
            writer.write(encoder.encode(createEvent('content_block_stop', { type: 'content_block_stop', index: 0 })));
            writer.write(encoder.encode(createEvent('message_delta', {
              type: 'message_delta',
              delta: { stop_reason: stop_reason || 'end_turn', stop_sequence: stop_sequence || null },
              usage: { output_tokens: 0 },
            })));
            writer.write(encoder.encode(createEvent('message_stop', { type: 'message_stop' })));
          }
          writer.close();
        } else {
          writer.write(encoder.encode(createEvent('content_block_delta', oaiAPI ? {
            choices: [{ index: 0, delta: { content: data }, logprobs: null, finish_reason: null }]
          } : {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: data },
          }, oaiAPI)));
        }
      } else if (end) stop_flag = true;
      else completionAll += data;
    }
  } else {
    return new Response('pplx-proxy worker edtion', { status: 404 });
  }
}

function createEvent(event, data, oaiAPI) {
  if (typeof data === 'object') {
    data = JSON.stringify(data);
  }
  return oaiAPI ? `data: ${data}\n\n` : `event: ${event}\ndata: ${data}\n\n`;
}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});