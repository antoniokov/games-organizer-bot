import serverlessHttp from 'serverless-http';
import {Telegraf, Markup} from 'telegraf';
import express from 'express';
import Fibery from 'fibery-unofficial';
import escape from "escape-html";


const app = express();
app.use(express.json());

const botToken = process.env.BOT_TOKEN;
if (!botToken) {
    throw new Error('Please provide BOT_TOKEN')
}

const bot = new Telegraf(botToken);

const fibery = new Fibery({
    host: process.env.FIBERY_HOST,
    token: process.env.FIBERY_SYNC_TOKEN,
});

const logAndReturnError = (res, code, error) => {
    console.error(error);
    return res.status(code).send(error);
};

const buildMessage = (game) => {
    const name = `<b>${game.name || 'Untitled'}</b>`;

    const place = game.address && game.googleMapsLink
        ? `<a href = "${game.googleMapsLink}">${game.address}</a>`
        : game.address || game.googleMapsLink || null;

    const limit = game.limit ? ` (max. ${game.limit})` : '';
    const participantsHeader = `\n<b>Participants</b>${limit}:`;
    const participants = game.participants ? escape(game.participants) : '(click ➕ to sign up)';
    const waitlist = game.reserves ? `\n<b>Waitlist</b> \n${escape(game.reserves)}` : null;

    const text = [name, place, participantsHeader, participants, waitlist].filter(Boolean).join(`\n`);

    const keyboard = Markup.inlineKeyboard([
        Markup.button.callback('➕', 'SIGN_UP'),
        Markup.button.callback('❌', 'OPT_OUT')
    ]);

    const extra = {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...keyboard
    };

    return [text, extra];
};

app.post('/sync-game', async (req, res) => {
    const { telegram, game } = req.body;

    if(!game) return logAndReturnError(res, 400, 'Game object is missing');
    if(!telegram) return logAndReturnError(res, 400, 'Telegram object is missing');

    const [messageText, messageExtra] = buildMessage(game);

    if (!telegram.messageId) {
        try {
            console.log(`Announcing the Game in Telegram, chat ${telegram.chatId}...`);
            const message = await bot.telegram.sendMessage(telegram.chatId, messageText, messageExtra);
            console.log('Game announced');

            if(!game.type) return logAndReturnError(res, 400, `Can't set Message ID in Fibery: game Type is missing`);
            if(!game.id) return logAndReturnError(res, 400, `Can't set Message ID in Fibery: game ID is missing`);

            const [appName, typeName] = game.type.split('/');
            try {
                const messageId = message.message_id.toString();
                console.log(`Setting Message ID to ${messageId} for the Game in Fibery...`);
                await fibery.entity.updateBatch([{
                    'type': game.type,
                    'entity': {
                        'fibery/id': game.id,
                        [`${appName}/Telegram Message ID`]: messageId
                    }
                }]);
            } catch (err) {
                return logAndReturnError(res, 500, `Failed to update the Game in Fibery: ${err}`);
            }

            console.log('Message ID set');
            return res.sendStatus(200);
        } catch (err) {
            return logAndReturnError(res, 500, `Failed to send message to Telegram: ${err}`);
        }
    } else {
        try {
            console.log(`Updating the message ${telegram.messageId} in chat ${telegram.chatId}...`);
            await bot.telegram.editMessageText(telegram.chatId, telegram.messageId, undefined, messageText, messageExtra);

            console.log('Message updated');
            return res.sendStatus(200);
        } catch (err) {
            if (err.message.includes('message is not modified')) {
                console.log('No need to update the message');
                return res.sendStatus(200);
            }

            return logAndReturnError(res, 500, `Failed to edit message in Telegram: ${err}`);
        }
    }
});

export const handler = serverlessHttp(app);