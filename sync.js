import serverlessHttp from 'serverless-http';
import {Telegraf, Markup} from 'telegraf';
import express from 'express';
import Fibery from 'fibery-unofficial';


const app = express();
app.use(express.json());

const token = process.env.BOT_TOKEN;
if (token === undefined) {
    throw new Error('Please provide BOT_TOKEN')
}

const bot = new Telegraf(token);

const fibery = new Fibery({
    host: process.env.FIBERY_HOST,
    token: process.env.FIBERY_TOKEN,
});

app.post('/sync-game', (req, res) => {
    const {gameType, gameId, chatId, messageId, name, limit, participants, reserves} = req.body;

    const message = [
        `* ${name}*`,
        limit ? `*Limit*: ${limit} participants` : null,
        `\n*Participants* \n${participants || '(click ➕ to sign up)'}`,
        reserves ? `\n*Waitlist* \n${reserves}` : null
    ].join(`\n`);

    if (!messageId) {
        bot.telegram.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                Markup.button.callback('➕', 'SIGN_UP'),
                Markup.button.callback('❌', 'OPT_OUT')
            ])
        }).then((message) => {
            if (!gameId || !gameType) {
                res.status(500).send('Either gameId or gameType is missing');
                return;
            }

            const [appName, typeName] = gameType.split('/');
            fibery.entity.updateBatch([{
                'type': gameType,
                'entity': {
                    'fibery/id': gameId,
                    [`${appName}/Message ID`]: message.message_id.toString()
                }
            }]).then(() => {
                res.sendStatus(200);
            }).catch(err => {
                console.error(err);
                res.status(500).send('Failed to update the Game in Fibery');
            });

        }).catch(err => {
            console.log(err);
            res.status(500).send('Failed to send message');
        });
    } else {
        bot.telegram.editMessageText(chatId, messageId, undefined, message, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                Markup.button.callback('➕', 'SIGN_UP'),
                Markup.button.callback('❌', 'OPT_OUT')
            ])
        }).then(() => {
            res.sendStatus(200);
        }).catch(err => {
            console.log(err);
            res.status(500).send('Failed to edit message');
        });
    }
});

export const handler = serverlessHttp(app);