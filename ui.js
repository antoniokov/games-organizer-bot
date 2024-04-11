import serverlessHttp from 'serverless-http';
import { Telegraf } from 'telegraf';
import Fibery from 'fibery-unofficial';
import * as console from "node:console";

const botToken = process.env.BOT_TOKEN;
if (!botToken) {
    throw new Error('Please provide BOT_TOKEN in .env file');
}

const bot = new Telegraf(botToken);

if(!process.env.FIBERY_HOST || !process.env.FIBERY_UI_TOKEN) {
    throw new Error('Please provide FIBERY_HOST and FIBERY_UI_TOKEN in .env file');
}

const fibery = new Fibery({
    host: process.env.FIBERY_HOST,
    token: process.env.FIBERY_UI_TOKEN,
});
const fiberyApp = process.env.FIBERY_APP || 'Organizer';

const cache = {
    players: new Map(),
    games: new Map()
};

const getOrCreatePlayer = async (id, firstName, lastName, username) => {
    const cachedPlayer = cache.players.get(id);
    if (cachedPlayer) {
        console.log(`Found Player in cache: ${id} → ${cachedPlayer.id}`);
        return cachedPlayer;
    }

    console.log(`Looking for a Player in Fibery by Telegram User ID: ${id.toString()}...`);
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
        const player = existingPlayers[0];
        console.log(`Player found: ${player.id}`);
        cache.players.set(id, player);
        return player;
    } else {
        console.log('Player not found, creating a new one...');
        const newPlayers = await fibery.entity.createBatch([{
            'type': `${fiberyApp}/Player`,
            'entity': {
                [`${fiberyApp}/Telegram User ID`]: id.toString(),
                [`${fiberyApp}/First Name (TG)`]: firstName,
                [`${fiberyApp}/Last Name (TG)`]: lastName,
                [`${fiberyApp}/Username (TG)`]: username
            }
        }]);

        const player = { id: newPlayers[0]['fibery/id'] };
        console.log(`Player created: ${player.id}`);
        cache.players.set(id, player);
        return player;
    }
};

const getGame = async (chatId, messageId) => {
    const cachedGame = cache.games.get(`${chatId}/${messageId}`);
    if (cachedGame) {
        console.log(`Found Game in cache: ${chatId}/${messageId} → ${cachedGame.id}`);
        // return cachedGame;
        // TODO: consider using cache if checking for active registrations in Fibery is not necessary
    }

    console.log(`Looking for a Game by Telegram Chat ID (${chatId.toString()}) and Message ID (${messageId.toString()})...`);
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

    const game = games[0];
    console.log(`Game found: ${game.id}`);
    cache.games.set(`${chatId}/${messageId}`, game);
    return games[0];
}


bot.action('SIGN_UP', async (ctx) => {
    const user = ctx.callbackQuery.from;
    const message = ctx.callbackQuery.message;

    try {
        const [player, game] = await Promise.all([
            getOrCreatePlayer(user.id, user.first_name, user.last_name, user.username),
            getGame(message.chat.id, message.message_id)
        ]);

        const isRegistered = game.activeRegistrations.some(ar => ar.playerId === player.id);
        if (isRegistered) {
            return await ctx.answerCbQuery(`You are already signed up 🤷`);
        }

        const currentDate = new Date();
        console.log(`Signing up Player ${player.id} for Game ${game.id}...`);
        await fibery.entity.createBatch([{
            'type': `${fiberyApp}/Registration`,
            'entity': {
                [`${fiberyApp}/Game`]: { 'fibery/id': game.id },
                [`${fiberyApp}/Player`]: { 'fibery/id': player.id },
                [`${fiberyApp}/Signed up at`]: currentDate.toISOString(),
            }
        }]);
    } catch (err) {
        console.error(err);
        return await ctx.answerCbQuery(`Something went wrong 😬\n${err}`);
    }

    console.log(`Signed up successfully`);
    return await ctx.answerCbQuery(`You've signed up 👌`);
});


bot.action('OPT_OUT', async (ctx) => {
    const user = ctx.callbackQuery.from;
    const message = ctx.callbackQuery.message;

    try {
        const [player, game] = await Promise.all([
            getOrCreatePlayer(user.id, user.first_name, user.last_name, user.username),
            getGame(message.chat.id, message.message_id)
        ]);

        const activeRegistrations =  game.activeRegistrations.filter(ar => ar.playerId === player.id);

        if (activeRegistrations.length === 0) {
            console.log(`No active registrations found for Player ${player.id}`);
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

        console.log(`Opting out of Registration(s) ${activeRegistrations.map(ar => ar.id).join(', ')}...`);
        await fibery.entity.updateBatch(updates);
    } catch (err) {
        console.error(err);
        return await ctx.answerCbQuery(`Something went wrong 😬\n${err}`);
    }

    console.log('Opted out successfully');
    return await ctx.answerCbQuery(`You've opted out 👌`);
});

export const handler = serverlessHttp(bot.webhookCallback("/bot"));