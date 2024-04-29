"use strict";
//const {randomInt, randomBytes} = require('node:crypto');
//const {countTokens} = require('@anthropic-ai/tokenizer');
const ROLE_PREFIXS = {
    user: 'Human',
    assistant: 'Assistant',
    example_user: 'H',
    example_assistant: 'A',
    system: 'xmlPlot'
};

const HyperProcess = (system, messages) => {
    const xmlPlot_merge = (content, mergeTag) => {
        if (/(\n\n|^\s*)xmlPlot:\s*/.test(content)) {
            content = content.replace(/(\n\n|^\s*)(?<!\n\n(Human|Assistant):.*?)xmlPlot:\s*/gs, '$1').replace(/(\n\n|^\s*)xmlPlot: */g, mergeTag.system && mergeTag.human && mergeTag.all ? '\n\nHuman: ' : '$1' );
        }
        mergeTag.all && mergeTag.human && (content = content.replace(/(?:\n\n|^\s*)Human:(.*?(?:\n\nAssistant:|$))/gs, function(match, p1) {return '\n\nHuman:' + p1.replace(/\n\nHuman:\s*/g, '\n\n')}));
        mergeTag.all && mergeTag.assistant && (content = content.replace(/\n\nAssistant:(.*?(?:\n\nHuman:|$))/gs, function(match, p1) {return '\n\nAssistant:' + p1.replace(/\n\nAssistant:\s*/g, '\n\n')}));
        return content;
    }, xmlPlot_regex = (content, order) => {
        let regexLog = '', matches = content.match(new RegExp(`<regex(?: +order *= *${order})${order === 2 ? '?' : ''}> *"(/?)(.*)\\1(.*?)" *: *"(.*?)" *</regex>`, 'gm'));
        matches && matches.forEach(match => {
            try {
                const reg = /<regex(?: +order *= *\d)?> *"(\/?)(.*)\1(.*?)" *: *"(.*?)" *<\/regex>/.exec(match);
                regexLog += match + '\n';
                content = content.replace(new RegExp(reg[2], reg[3]), JSON.parse(`"${reg[4].replace(/\\?"/g, '\\"')}"`));
            } catch {}
        });
        return [content, regexLog];
    }, HyperPmtProcess = (content) => {
        const regex1 = xmlPlot_regex(content, 1);
        content = regex1[0], regexLogs += regex1[1];
        const mergeTag = {
            all: !content.includes('<|Merge Disable|>'),
            system: !content.includes('<|Merge System Disable|>'),
            human: !content.includes('<|Merge Human Disable|>'),
            assistant: !content.includes('<|Merge Assistant Disable|>')
        };
        content = xmlPlot_merge(content, mergeTag);
        let splitContent = content.split(/\n\n(?=Assistant:|Human:)/g), match;
        while ((match = /<@(\d+)>(.*?)<\/@\1>/gs.exec(content)) !== null) {
            let index = splitContent.length - parseInt(match[1]) - 1;
            index >= 0 && (splitContent[index] += '\n\n' + match[2]);
            content = content.replace(match[0], '');
        }
        content = splitContent.join('\n\n').replace(/<@(\d+)>.*?<\/@\1>/gs, '');
        const regex2 = xmlPlot_regex(content, 2);
        content = regex2[0], regexLogs += regex2[1];
        content = xmlPlot_merge(content, mergeTag);
        const regex3 = xmlPlot_regex(content, 3);
        content = regex3[0], regexLogs += regex3[1];
        content = content.replace(/<regex( +order *= *\d)?>.*?<\/regex>/gm, '')
            .replace(/\r\n|\r/gm, '\n')
            .replace(/\s*<\|curtail\|>\s*/g, '\n')
            .replace(/\s*<\|join\|>\s*/g, '')
            .replace(/\s*<\|space\|>\s*/g, ' ')
            .replace(/\s*\n\n(H(uman)?|A(ssistant)?): +/g, '\n\n$1: ')
            .replace(/<\|(\\.*?)\|>/g, function(match, p1) {
                try {
                    return JSON.parse(`"${p1.replace(/\\?"/g, '\\"')}"`);
                } catch { return match }
            });
        //tokens = countTokens(content);
        //const placeholder = uuidv4();
        //const placeholdertokens = countTokens(placeholder.trim());
        //while (match = content.match(/<\|padtxt.*?(\d+)t.*?\|>/)) {
            //content = content.replace(match[0], placeholder.repeat(parseInt(match[1]) / placeholdertokens));
            //tokens += parseInt(match[1]);
        //}
        return content.replace(/\s*<\|.*?\|>\s*/g, '\n\n')
            .replace(/^\s*\n\nHuman:\s*/s, '')
            .trim().replace(/^.+:/, '\n\n$&')
            .replace(/(?<=\n)\n(?=\n)/g, '');
    };
    let prompt = system || '', tokens, regexLogs = '';
    messages.forEach(message => {
        const prefix = '\n\n' + ROLE_PREFIXS[message.role] + ': ';
        prompt += `${prefix}${message.content.trim()}`;
    });
    return {prompt: HyperPmtProcess(prompt), log: `${tokens}t\n####### Regex:\n${regexLogs}`};
};

module.exports = {
    HyperProcess
};