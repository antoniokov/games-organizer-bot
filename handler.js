import http from 'serverless-http';
import { Telegraf } from 'telegraf';

const token = process.env.BOT_TOKEN;
if (token === undefined) {
    throw new Error('Please provide BOT_TOKEN')
}

const bot = new Telegraf(token);

// echo
bot.on('message', ctx => ctx.reply(`Echo: ${ctx.message.text}`));

// setup webhook
export const echobot = http(bot.webhookCallback("/bot"));