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

app.post('/sync-game', async (req, res) => {
    const {gameType, gameId, chatId, messageId, name, limit, participants, reserves} = req.body;

    const messageText = [
        `*${name}*`,
        limit ? `*Limit*: ${limit} participants` : null,
        `\n*Participants* \n${participants || '(click ➕ to sign up)'}`,
        reserves ? `\n*Waitlist* \n${reserves}` : null
    ].join(`\n`);

    const keyboard = Markup.inlineKeyboard([
        Markup.button.callback('➕', 'SIGN_UP'),
        Markup.button.callback('❌', 'OPT_OUT')
    ]);

    if (!messageId) {
        try {
            const message = await bot.telegram.sendMessage(chatId, messageText, {
                parse_mode: 'Markdown',
                ...keyboard
            });

            if (!gameId || !gameType) {
                res.status(400).send('Either gameId or gameType is missing');
                return;
            }

            const [appName, typeName] = gameType.split('/');
            try {
                await fibery.entity.updateBatch([{
                    'type': gameType,
                    'entity': {
                        'fibery/id': gameId,
                        [`${appName}/Telegram Message ID`]: message.message_id.toString()
                    }
                }]);
            } catch (err) {
                console.error(err);
                res.status(500).send('Failed to update the Game in Fibery');
                return;
            }

            res.sendStatus(200);
        } catch (err) {
            console.error(err);
            res.status(500).send('Failed to send message to Telegram');
        }
    } else {
        try {
            await bot.telegram.editMessageText(chatId, messageId, undefined, messageText, {
                parse_mode: 'Markdown',
                ...keyboard
            });

            res.sendStatus(200);
        } catch (err) {
            console.error(err);
            res.status(500).send('Failed to edit message in Telegram');
        }
    }
});

export const handler = serverlessHttp(app);