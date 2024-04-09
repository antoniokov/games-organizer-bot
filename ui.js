import serverlessHttp from 'serverless-http';
import { Telegraf } from 'telegraf';
import Fibery from 'fibery-unofficial';

const token = process.env.BOT_TOKEN;
if (token === undefined) {
    throw new Error('Please provide BOT_TOKEN')
}

const bot = new Telegraf(token);

const fibery = new Fibery({
    host: process.env.FIBERY_HOST,
    token: process.env.FIBERY_TOKEN,
});

bot.action('SIGN_UP', async (ctx) => {
    const fiberyApp = process.env.FIBERY_APP;

    // two parallel queries: for the Player (Telegram ID)
    // and the Game (Message ID)
    const players = await fibery.entity.query({
        'q/from': `${fiberyApp}/Players`,
        'q/select': [
            'fibery/id',
            `${fiberyApp}/Name`,
            `${fiberyApp}/First Name (TG)`,
            `${fiberyApp}/Last Name (TG)`,
            `${fiberyApp}/Username (TG)`,
        ],
        'q/where': ['=', [`${fiberyApp}/Telegram ID`], '$id'],
        'q/limit': 1
    }, { '$id': ctx.from.id.toString() });

    if (players.length === 0) {
        // create a Player
    }

    const player = players[0];
    const currentDate = new Date();

    const signUp = await fibery.entity.createBatch([{
        'type': `${fiberyApp}/Sign-ups`,
        'entity': {
            [`${fiberyApp}/Game`]: { 'fibery/id': '005734d0-f509-11ee-b3d9-6fdd149e4653' },
            [`${fiberyApp}/Player`]: { 'fibery/id': player['fibery/id'] },
            [`${fiberyApp}/Signed up at`]: currentDate.toISOString(),
        }
    }]);

    return await ctx.answerCbQuery(`You've signed up 👌`);
});

// setup webhook
export const handler = serverlessHttp(bot.webhookCallback("/bot"));