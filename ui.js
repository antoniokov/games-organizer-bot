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

const getOrCreatePlayer = async (id, firstName, lastName, username) => {
    const existingPlayers = await fibery.entity.query({
        'q/from': `${fiberyApp}/Player`,
        'q/select': { id: 'fibery/id' },
        'q/where': ['=', [`${fiberyApp}/Telegram User ID`], '$user_id'],
        'q/order-by': [
            [['fibery/creation-date'], 'q/asc'],
            [['fibery/rank'], 'q/asc']
        ],
        'q/limit': 1
    }, { '$user_id': id.toString() });

    if (existingPlayers.length === 1) {
        return existingPlayers[0];
    } else {
        const newPlayers = await fibery.entity.createBatch([{
            'type': `${fiberyApp}/Player`,
            'entity': {
                [`${fiberyApp}/Telegram User ID`]: id.toString(),
                [`${fiberyApp}/First Name (TG)`]: firstName,
                [`${fiberyApp}/Last Name (TG)`]: lastName,
                [`${fiberyApp}/Username (TG)`]: username
            }
        }]);

        return { id: newPlayers[0]['fibery/id'] };
    }
};

const getGame = async (chatId, messageId) => {
    const games = await fibery.entity.query({
        'q/from': `${fiberyApp}/Game`,
        'q/select': {
            id: 'fibery/id',
            activeRegistrations: {
                'q/from': `${fiberyApp}/Registrations`,
                'q/select': {
                    id: 'fibery/id',
                    playerId: [`${fiberyApp}/Player`, 'fibery/id']
                },
                'q/where': ['=', ['q/null?', [`${fiberyApp}/Opted out at`]], true],
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
    const user = ctx.callbackQuery.from;
    const message = ctx.callbackQuery.message;

    const [player, game] = await Promise.all([
        getOrCreatePlayer(user.id, user.first_name, user.last_name, user.username),
        getGame(message.chat.id, message.message_id)
    ]);
    // TODO: catch and inform user of the error if they can act on it

    const isRegistered = game.activeRegistrations.some(ar => ar.playerId === player.id);
    if (isRegistered) {
        return await ctx.answerCbQuery(`You are already signed up 🤷`);
    }

    const currentDate = new Date();
    const newRegistration = await fibery.entity.createBatch([{
        'type': `${fiberyApp}/Registration`,
        'entity': {
            [`${fiberyApp}/Game`]: { 'fibery/id': game.id },
            [`${fiberyApp}/Player`]: { 'fibery/id': player.id },
            [`${fiberyApp}/Signed up at`]: currentDate.toISOString(),
        }
    }]);

    return await ctx.answerCbQuery(`You've signed up 👌`);
});


bot.action('OPT_OUT', async (ctx) => {
    const user = ctx.callbackQuery.from;
    const message = ctx.callbackQuery.message;

    const [player, game] = await Promise.all([
        getOrCreatePlayer(user.id, user.first_name, user.last_name, user.username),
        getGame(message.chat.id, message.message_id)
    ]);
    // TODO: catch and inform user of the error if they can act on it

    const activeRegistrations =  game.activeRegistrations.filter(ar => ar.playerId === player.id);

    if (activeRegistrations.length === 0) {
        return await ctx.answerCbQuery(`You don't have any active registrations 🤷`);
    }

    const currentDate = new Date();
    const updates = activeRegistrations.map(ar => ({
        'type': `${fiberyApp}/Registration`,
        'entity': {
            'fibery/id': ar.id,
            [`${fiberyApp}/Opted out at`]: currentDate.toISOString()
        }
    }));

    const result = await fibery.entity.updateBatch(updates);
    return await ctx.answerCbQuery(`You've opted out 👌`);
});


export const handler = serverlessHttp(bot.webhookCallback("/bot"));