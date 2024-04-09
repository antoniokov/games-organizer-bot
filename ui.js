import serverlessHttp from 'serverless-http';
import { Telegraf } from 'telegraf';
import Fibery from 'fibery-unofficial';

const botToken = process.env.BOT_TOKEN;
if (!botToken) {
    throw new Error('Please provide BOT_TOKEN in .env file');
}

const bot = new Telegraf(botToken);

if(!process.env.FIBERY_HOST || !process.env.FIBERY_TOKEN) {
    throw new Error('Please provide FIBERY_HOST and FIBERY_TOKEN in .env file');
}

const fibery = new Fibery({
    host: process.env.FIBERY_HOST,
    token: process.env.FIBERY_TOKEN,
});
const fiberyApp = process.env.FIBERY_APP || 'Organizer';

const getOrCreatePlayer = async (userId) => {
    const players = await fibery.entity.query({
        'q/from': `${fiberyApp}/Players`,
        'q/select': { id: 'fibery/id' },
        'q/where': ['=', [`${fiberyApp}/Telegram User ID`], '$user_id'],
        'q/order-by': [
            [['fibery/creation-date'], 'q/asc'],
            [['fibery/rank'], 'q/asc']
        ],
        'q/limit': 1
    }, { '$user_id': userId.toString() });

    if (players.length === 0) {
        // TODO: create a Player
    }

    return players[0];
};

const getGame = async (chatId, messageId) => {
    const games = await fibery.entity.query({
        'q/from': `${fiberyApp}/Games`,
        'q/select': {
            id: 'fibery/id',
            signUps: {
                'q/from': `${fiberyApp}/Sign-ups`,
                'q/select': {
                    player: [`${fiberyApp}/Player`, 'fibery/id']
                },
                'q/limit': 'q/no-limit'
            }
        },
        'q/where': ['and',
            ['=', [`${fiberyApp}/Telegram Chat ID`], '$chat_id'],
            ['=', [`${fiberyApp}/Telegram Message ID`], '$message_id']
        ],
        'q/order-by': [
            [['fibery/creation-date'], 'q/desc'],
            [['fibery/rank'], 'q/asc']
        ],
        'q/limit': 1
    }, {
        '$chat_id': chatId.toString(),
        '$message_id': messageId.toString()
    });

    if (games.length === 0) {
        throw new Error('Game not found in Fibery');
    }

    return games[0];
}

bot.action('SIGN_UP', async (ctx) => {
    const [player, game] = await Promise.all([
        getOrCreatePlayer(ctx.callbackQuery.from.id),
        getGame(ctx.callbackQuery.message.chat.id, ctx.callbackQuery.message.message_id)
    ]);
    // TODO: catch and inform user of the error if they can act on it

    const existingSignUps = game.signUps.filter(s => s.player === player.id);
    if (existingSignUps.length > 0) {
        return await ctx.answerCbQuery(`You are already signed up 🤷`);
    }

    const currentDate = new Date();
    const signUp = await fibery.entity.createBatch([{
        'type': `${fiberyApp}/Sign-ups`,
        'entity': {
            [`${fiberyApp}/Game`]: { 'fibery/id': game.id },
            [`${fiberyApp}/Player`]: { 'fibery/id': player.id },
            [`${fiberyApp}/Signed up at`]: currentDate.toISOString(),
        }
    }]);

    return await ctx.answerCbQuery(`You've signed up 👌`);
});

// setup webhook
export const handler = serverlessHttp(bot.webhookCallback("/bot"));