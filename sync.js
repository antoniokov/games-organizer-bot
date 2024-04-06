import serverlessHttp from 'serverless-http';
import { Telegraf } from 'telegraf';
import express from 'express';
import * as console from "node:console";


const app = express();
app.use(express.json());

const token = process.env.BOT_TOKEN;
if (token === undefined) {
    throw new Error('Please provide BOT_TOKEN')
}

const bot = new Telegraf(token);

app.post('/sync-game', (req, res) => {
    const { chatId, messageId, name, limit, participants, reserves } = req.body;

    const message = [
        `* ${name}* \n*Limit*: ${limit} participants`,
        `*Participants* \n${participants}`,
        reserves ? `*Waitlist* \n${reserves}` : ''
    ].join(`\n\n`);

    if(!messageId) {
        bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown'} ).then((message) => {
            console.log(message.message_id);
            res.sendStatus(200);
        }).catch(err => {
            console.log(err);
            res.status(500).send('Failed to send message');
        });
    } else {
        bot.telegram.editMessageText(chatId, messageId, undefined, message).then(() => {
            res.sendStatus(200);
        }).catch(err => {
            console.log(err);
            res.status(500).send('Failed to edit message');
        });
    }
});

export const handler = serverlessHttp(app);