import serverlessHttp from 'serverless-http';
import {Telegraf, Markup} from 'telegraf';
import express from 'express';
import Fibery from 'fibery-unofficial';


const app = express();
app.use(express.json());

const botToken = process.env.BOT_TOKEN;
if (!botToken) {
    throw new Error('Please provide BOT_TOKEN')
}

const bot = new Telegraf(botToken);

const fibery = new Fibery({
    host: process.env.FIBERY_HOST,
    token: process.env.FIBERY_TOKEN,
});

const logAndReturnError = (res, code, error) => {
    console.error(error);
    return res.status(code).send(error);
};

const buildMessageText = (game) => {
    const name = `*${game.name || 'Untitled'}*`;

    const place = game.address && game.googleMapsLink
        ? `[${game.address}](${game.googleMapsLink})`
        : game.address || game.googleMapsLink || null;

    const limit = game.limit ? ` (max. ${game.limit})` : '';
    const participantsHeader = `\n*Participants*${limit}:`;
    const participants = `${game.participants || '(click ➕ to sign up)'}`;
    const waitlist = game.reserves ? `\n*Waitlist* \n${game.reserves}` : null;

    return [name, place, participantsHeader, participants, waitlist].filter(Boolean).join(`\n`);
};

app.post('/sync-game', async (req, res) => {
    const { telegram, game } = req.body;

    if(!game) return logAndReturnError(res, 400, 'Game object is missing');
    if(!telegram) return logAndReturnError(res, 400, 'Telegram object is missing');

    const messageText = buildMessageText(game);
    const keyboard = Markup.inlineKeyboard([
        Markup.button.callback('➕', 'SIGN_UP'),
        Markup.button.callback('❌', 'OPT_OUT')
    ]);

    if (!telegram.messageId) {
        try {
            const message = await bot.telegram.sendMessage(telegram.chatId, messageText, {
                parse_mode: 'Markdown',
                ...keyboard
            });

            if(!game.type) return logAndReturnError(res, 400, `Can't set Message ID in Fibery: game Type is missing`);
            if(!game.id) return logAndReturnError(res, 400, `Can't set Message ID in Fibery: game ID is missing`);

            const [appName, typeName] = game.type.split('/');
            try {
                await fibery.entity.updateBatch([{
                    'type': game.type,
                    'entity': {
                        'fibery/id': game.id,
                        [`${appName}/Telegram Message ID`]: message.message_id.toString()
                    }
                }]);
            } catch (err) {
                return logAndReturnError(res, 500, `Failed to update the Game in Fibery: ${err}`);
            }

            res.sendStatus(200);
        } catch (err) {
            return logAndReturnError(res, 500, `Failed to send message to Telegram: ${err}`);
        }
    } else {
        try {
            await bot.telegram.editMessageText(telegram.chatId, telegram.messageId, undefined, messageText, {
                parse_mode: 'Markdown',
                ...keyboard
            });

            res.sendStatus(200);
        } catch (err) {
            return logAndReturnError(res, 500, `Failed to edit message in Telegram: ${err}`);
        }
    }
});

export const handler = serverlessHttp(app);