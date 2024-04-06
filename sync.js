import serverlessHttp from 'serverless-http';
import { Telegraf } from 'telegraf';
import express from 'express';


const app = express();
app.use(express.json()); // For parsing application/json request

const token = process.env.BOT_TOKEN;
if (token === undefined) {
    throw new Error('Please provide BOT_TOKEN')
}

const bot = new Telegraf(token);

// Define endpoint to receive external requests for bot to send message
app.post('/new-game', (req, res) => {
    const { chatId, message } = req.body;

    bot.telegram.sendMessage(chatId, message).then(() => {
        res.sendStatus(200);
    }).catch(err => {
        res.status(500).send('Failed to send message');
    });
});

// Wrap your Express app instance with serverless-http, so that it can work with AWS Lambda
export const handler = serverlessHttp(app);