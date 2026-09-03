import { randomUUID } from 'node:crypto';
import serverlessHttp from 'serverless-http';
import { Telegraf } from 'telegraf';
import Fibery from 'fibery-unofficial';

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

// Creates an entity unless one with the same Conflict Field value is already there, so that
// a Telegram redelivery — or another invocation racing this one — can't insert a second row.
// Both Conflict Fields are unique in Fibery, which is what makes it hold under concurrency.
const createUnlessDuplicate = async (type, entity, conflictField) => {
    try {
        const [result] = await fibery.command.execute({
            command: 'fibery.entity.batch/create-or-update',
            args: {
                type,
                entities: [{ 'fibery/id': randomUUID(), ...entity }],
                'conflict-field': conflictField,
                'conflict-action': 'skip-create'
            }
        });

        // On create Fibery returns the new entity, on skip-create the duplicate it found
        return {
            id: (result.created || result.duplicate)['fibery/id'],
            isDuplicate: result.action !== 'create'
        };
    } catch (err) {
        // A Conflict Field with a uniqueness constraint rejects the losing write outright
        // instead of skipping it, so check whether what we wanted is already there
        const [existing] = await fibery.entity.query({
            'q/from': type,
            'q/select': { id: 'fibery/id' },
            'q/where': ['=', [conflictField], '$conflict_value'],
            'q/limit': 1
        }, { '$conflict_value': entity[conflictField] });

        if (!existing) {
            throw err;
        }

        return { id: existing.id, isDuplicate: true };
    }
};

const getOrCreatePlayer = async (id, firstName, lastName, username) => {
    const cachedPlayer = cache.players.get(id);
    if (cachedPlayer) {
        console.log(`Found Player in cache: ${id} → ${cachedPlayer.id}`);
        return cachedPlayer;
    }

    console.log(`Looking for a Player in Fibery by Telegram User ID: ${id.toString()}...`);
    const { id: playerId, isDuplicate } = await createUnlessDuplicate(`${fiberyApp}/Player`, {
        [`${fiberyApp}/Telegram User ID`]: id.toString(),
        [`${fiberyApp}/First Name (TG)`]: firstName,
        [`${fiberyApp}/Last Name (TG)`]: lastName,
        [`${fiberyApp}/Username (TG)`]: username
    }, `${fiberyApp}/Telegram User ID`);

    console.log(isDuplicate ? `Player found: ${playerId}` : `Player created: ${playerId}`);

    const player = { id: playerId };
    cache.players.set(id, player);
    return player;
};

const getGame = async (chatId, messageId) => {
    const cachedGame = cache.games.get(`${chatId}/${messageId}`);
    if (cachedGame) {
        console.log(`Found Game in cache: ${chatId}/${messageId} → ${cachedGame.id}`);
        // return cachedGame;
        // TODO: consider using cache if checking for active registrations in Fibery is not necessary
    }

    console.log(`Looking for a Game in Fibery by Telegram Chat ID (${chatId.toString()}) and Message ID (${messageId.toString()})...`);
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
    console.log('New sign-up');

    const user = ctx.callbackQuery.from;
    const message = ctx.callbackQuery.message;

    try {
        const [player, game] = await Promise.all([
            getOrCreatePlayer(user.id, user.first_name, user.last_name, user.username),
            getGame(message.chat.id, message.message_id)
        ]);

        const activeRegistrationIds =  game.activeRegistrations
            .filter(ar => ar.playerId === player.id)
            .map(ar => ar.id)
            .join(', ');

        if (activeRegistrationIds) {
            console.log(`Active Registration(s) for Player ${player.id} found: ${activeRegistrationIds}`);
            return await ctx.answerCbQuery(`You are already signed up 🤷`);
        }

        // Telegram redelivers an update until it gets a 200, always with the same callback
        // query id, so keying the Registration on it makes a redelivery a no-op. Two
        // genuinely simultaneous taps carry different ids and can still both land — rare,
        // and opting out clears every active Registration, so it's recoverable.
        const currentDate = new Date();
        console.log(`Signing up Player ${player.id} for Game ${game.id}...`);
        const registration = await createUnlessDuplicate(`${fiberyApp}/Registration`, {
            [`${fiberyApp}/Game`]: { 'fibery/id': game.id },
            [`${fiberyApp}/Player`]: { 'fibery/id': player.id },
            [`${fiberyApp}/Signed up at`]: currentDate.toISOString(),
            [`${fiberyApp}/Telegram Callback Query ID`]: ctx.callbackQuery.id
        }, `${fiberyApp}/Telegram Callback Query ID`);

        if (registration.isDuplicate) {
            console.log(`Registration ${registration.id} for this tap is already there — Telegram redelivered it`);
        }
    } catch (err) {
        console.error(err);
        return await ctx.answerCbQuery(`Something went wrong 😬\n${err}`);
    }

    console.log(`Signed up successfully`);
    return await ctx.answerCbQuery(`You've signed up 👌`);
});


bot.action('OPT_OUT', async (ctx) => {
    console.log('New opt-out');

    const user = ctx.callbackQuery.from;
    const message = ctx.callbackQuery.message;

    try {
        const [player, game] = await Promise.all([
            getOrCreatePlayer(user.id, user.first_name, user.last_name, user.username),
            getGame(message.chat.id, message.message_id)
        ]);

        const activeRegistrationIds =  game.activeRegistrations
            .filter(ar => ar.playerId === player.id)
            .map(ar => ar.id);

        if (activeRegistrationIds.length === 0) {
            console.log(`No active registrations found for Player ${player.id}`);
            return await ctx.answerCbQuery(`You don't have any active registrations 🤷`);
        }

        const currentDate = new Date();
        const updates = activeRegistrationIds.map(id => ({
            'type': `${fiberyApp}/Registration`,
            'entity': {
                'fibery/id': id,
                [`${fiberyApp}/Opted out at`]: currentDate.toISOString()
            }
        }));

        console.log(`Opting out of Registration(s) ${activeRegistrationIds.join(', ')}...`);
        await fibery.entity.updateBatch(updates);
    } catch (err) {
        console.error(err);
        return await ctx.answerCbQuery(`Something went wrong 😬\n${err}`);
    }

    console.log('Opted out successfully');
    return await ctx.answerCbQuery(`You've opted out 👌`);
});

export const handler = serverlessHttp(bot.webhookCallback("/bot"));