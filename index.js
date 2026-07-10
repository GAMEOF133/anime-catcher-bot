const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');

// 1. Configuration
const BOT_TOKEN = '8380688406:AAH4lWrMOxlfSSvB__1O8zDuQdPE_NwgMZg'; 
const ADMIN_ID = 7334867757; 

const bot = new Telegraf(BOT_TOKEN, { 
    handlerTimeout: 90000 
});

const DB_PATH = path.join(__dirname, 'db.json');

function readDB() {
    try {
        const data = fs.readFileSync(DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return { activeGroups: [], animeEdits: [] };
    }
}

function writeDB(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

const RARITIES = {
    RARE: { name: 'Rare 🟢', chance: 50 },
    EPIC: { name: 'Epic 🔵', chance: 30 },
    LEGENDARY: { name: 'Legendary 🟡', chance: 14 },
    MYTHIC: { name: 'Mythic 🔴', chance: 5 },
    LIMITED: { name: 'Limited 🟣', chance: 1 }
};

let adminState = {};

function getRandomEdit() {
    const db = readDB();
    if (db.animeEdits.length === 0) return null;

    const roll = Math.random() * 100;
    let currentChance = 0;
    let selectedRarity = 'RARE';

    for (const [key, value] of Object.entries(RARITIES)) {
        currentChance += value.chance;
        if (roll <= currentChance) {
            selectedRarity = key;
            break;
        }
    }

    const pool = db.animeEdits.filter(edit => edit.rarity === selectedRarity);
    if (pool.length === 0) return db.animeEdits[0]; 
    return pool[Math.floor(Math.random() * pool.length)];
}

async function spawnInChat(chatId) {
    const edit = getRandomEdit();
    if (!edit) return;

    const rarityInfo = RARITIES[edit.rarity];
    const captionText = `✨ **An Anime Edit Appeared!** ✨\n\n**Name:** ${edit.name}\n**Anime:** ${edit.anime}\n**Rarity:** ${rarityInfo.name}`;
    const replyMarkup = {
        inline_keyboard: [[{ text: 'Capture! 🎒', callback_data: `catch_${edit.id}` }]]
    };

    try {
        if (edit.type === 'video') {
            await bot.telegram.sendVideo(chatId, edit.file, { caption: captionText, parse_mode: 'Markdown', reply_markup: replyMarkup });
        } else if (edit.type === 'animation') {
            await bot.telegram.sendAnimation(chatId, edit.file, { caption: captionText, parse_mode: 'Markdown', reply_markup: replyMarkup });
        } else {
            await bot.telegram.sendPhoto(chatId, edit.file, { caption: captionText, parse_mode: 'Markdown', reply_markup: replyMarkup });
        }
    } catch (error) {
        console.error(`Failed to send spawn to chat ${chatId}:`, error.message);
    }
}

function spawnEditInGroups() {
    const db = readDB();
    if (db.activeGroups.length === 0) return;
    db.activeGroups.forEach((chatId) => spawnInChat(chatId));
}

bot.start((ctx) => {
    if (ctx.from.id === ADMIN_ID && ctx.chat.type === 'private') {
        adminState[ctx.from.id] = null; 
        return ctx.reply('Welcome back Admin! Use the control button below:', {
            reply_markup: {
                inline_keyboard: [[{ text: '➕ Add Edit', callback_data: 'admin_start_add' }]]
            }
        }).catch(() => {});
    }
    ctx.reply('Welcome to Anime Catcher Bot! Add me to a group and send /setup to activate.').catch(() => {});
});

bot.command('amir', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) {
        return ctx.reply('Unauthorized access! Only the owner can use this command.').catch(() => {});
    }
    spawnInChat(ctx.chat.id);
});

bot.command('setup', (ctx) => {
    if (ctx.chat.type === 'private') {
        return ctx.reply('This command can only be used inside Telegram Groups!').catch(() => {});
    }
    const chatId = ctx.chat.id;
    const db = readDB();
    
    if (!db.activeGroups.includes(chatId)) {
        db.activeGroups.push(chatId);
        writeDB(db);
    }
    ctx.reply('✅ Auto spawn system is now active in this group! An edit will spawn every 5 minutes.').catch(() => {});
});

bot.action('admin_start_add', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('Denied!').catch(() => {});
    ctx.answerCbQuery().catch(() => {});
    
    adminState[ctx.from.id] = { step: 'WAITING_FOR_FILE', data: {} };
    return ctx.reply('Please send or forward the Video or Photo for this edit:').catch(() => {});
});

bot.action(/set_rarity_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('Denied!').catch(() => {});
    
    const selectedRarity = ctx.match[1];
    const userState = adminState[ctx.from.id];
    
    if (!userState || !userState.data || !userState.data.file) {
        await ctx.answerCbQuery('Session expired. Please click ➕ Add Edit again.', { show_alert: true }).catch(() => {});
        return;
    }
    
    userState.data.rarity = selectedRarity;

    const db = readDB();
    
    // اصلاح اصلی: آیدی‌ها دقیقاً بر اساس ترتیب از 1 شروع می‌شوند
    const nextId = db.animeEdits.length + 1;
    userState.data.id = nextId;

    db.animeEdits.push(userState.data);
    writeDB(db);

    adminState[ctx.from.id] = null; 

    await ctx.answerCbQuery().catch(() => {});
    return ctx.reply(`✅ Successfully added!\n\nCode ID: ${userState.data.id}\nCharacter: ${userState.data.name}\nAnime: ${userState.data.anime}\nRarity: ${RARITIES[selectedRarity].name}`).catch(() => {});
});

bot.on('message', async (ctx) => {
    if (ctx.chat.type !== 'private' || ctx.from.id !== ADMIN_ID) return;
    
    const userState = adminState[ctx.from.id];
    if (!userState) return;

    if (userState.step === 'WAITING_FOR_FILE') {
        let fileId = null;
        let fileType = null;

        if (ctx.message.video) {
            fileId = ctx.message.video.file_id;
            fileType = 'video';
        } else if (ctx.message.photo) {
            fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            fileType = 'photo';
        } else if (ctx.message.animation) {
            fileId = ctx.message.animation.file_id;
            fileType = 'animation';
        }

        if (!fileId) {
            return ctx.reply('Invalid format! Please send a valid Video, GIF, or Photo:').catch(() => {});
        }

        userState.data.file = fileId;
        userState.data.type = fileType;
        userState.step = 'WAITING_FOR_NAME';
        
        return ctx.reply('What is the Character Name?').catch(() => {});
    }

    if (userState.step === 'WAITING_FOR_NAME') {
        if (!ctx.message.text) {
            return ctx.reply('Please type a text name for the character:').catch(() => {});
        }
        userState.data.name = ctx.message.text;
        userState.step = 'WAITING_FOR_ANIME';
        
        return ctx.reply('What is the Anime Name?').catch(() => {});
    }

    if (userState.step === 'WAITING_FOR_ANIME') {
        if (!ctx.message.text) {
            return ctx.reply('Please type a text name for the anime:').catch(() => {});
        }
        userState.data.anime = ctx.message.text;
        userState.step = 'WAITING_FOR_RARITY';

        const buttons = Object.keys(RARITIES).map(key => [{ text: RARITIES[key].name, callback_data: `set_rarity_${key}` }]);
        return ctx.reply('Select the Rarity for this edit:', {
            reply_markup: { inline_keyboard: buttons }
        }).catch(() => {});
    }
});

bot.action(/catch_(\d+)/, (ctx) => {
    const editId = parseInt(ctx.match[1]);
    const db = readDB();
    const edit = db.animeEdits.find(e => e.id === editId);
    
    if (!edit) {
        return ctx.answerCbQuery('This edit has expired!', { show_alert: true }).catch(() => {});
    }

    ctx.answerCbQuery(`Success! You captured ${edit.name}! 🎉`, { show_alert: true }).catch(() => {});
    
    ctx.editMessageCaption(`🎒 Captured by ${ctx.from.first_name}!\n\n**Name:** ${edit.name}\n**Rarity:** ${RARITIES[edit.rarity].name}`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [] }
    }).catch(() => {});
});

setInterval(spawnEditInGroups, 300000);

const http = require('http');
http.createServer((req, res) => {
    res.write("Bot is Running!");
    res.end();
}).listen(process.env.PORT || 3000);

bot.launch().then(() => console.log('✅ System ID fixed and active!'));
