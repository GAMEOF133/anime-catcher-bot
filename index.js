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
let activeSpawns = {};

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
    const captionText = `✨ **An Anime Edit Appeared!** ✨\n\n**Anime:** ${edit.anime}\n**Rarity:** ${rarityInfo.name}\n\n🗣️ **How to catch?** Reply to this message with:\n/cap CharacterName`;

    try {
        let sentMsg;
        if (edit.type === 'video') {
            sentMsg = await bot.telegram.sendVideo(chatId, edit.file, { caption: captionText, parse_mode: 'Markdown' });
        } else if (edit.type === 'animation') {
            sentMsg = await bot.telegram.sendAnimation(chatId, edit.file, { caption: captionText, parse_mode: 'Markdown' });
        } else {
            sentMsg = await bot.telegram.sendPhoto(chatId, edit.file, { caption: captionText, parse_mode: 'Markdown' });
        }

        activeSpawns[sentMsg.message_id] = {
            id: edit.id,
            name: edit.name.trim().toLowerCase(),
            fullName: edit.name,
            rarityName: rarityInfo.name,
            captured: false
        };

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
        return ctx.reply('Welcome back Admin! Choose an option:', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '➕ Add New Edit', callback_data: 'admin_start_add' }],
                    [{ text: '📂 Manage Edits (Edit/Delete)', callback_data: 'admin_manage_list_0' }]
                ]
            }
        }).catch(() => {});
    }
    ctx.reply('Welcome to Anime Catcher Bot! Add me to a group and send /setup to activate.').catch(() => {});
});

bot.command('amir', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    spawnInChat(ctx.chat.id);
});

bot.command('setup', (ctx) => {
    if (ctx.chat.type === 'private') return ctx.reply('This command only works in groups!');
    const chatId = ctx.chat.id;
    const db = readDB();
    if (!db.activeGroups.includes(chatId)) {
        db.activeGroups.push(chatId);
        writeDB(db);
    }
    ctx.reply('✅ Auto spawn system active! An edit will spawn every 5 minutes.').catch(() => {});
});

bot.command('cap', async (ctx) => {
    if (ctx.chat.type === 'private') return;
    
    if (!ctx.message.reply_to_message) {
        return ctx.reply('⚠️ Please reply to the anime edit message!').catch(() => {});
    }

    const replyMsgId = ctx.message.reply_to_message.message_id;
    const activeSpawn = activeSpawns[replyMsgId];

    if (!activeSpawn) return;
    if (activeSpawn.captured) {
        return ctx.reply('❌ This edit has already been captured by someone else!').catch(() => {});
    }

    const guess = ctx.message.text.replace('/cap', '').trim().toLowerCase();
    if (!guess) {
        return ctx.reply('⚠️ Please provide the character name after /cap (e.g., /cap Diego)').catch(() => {});
    }

    if (guess === activeSpawn.name) {
        activeSpawn.captured = true;
        
        try {
            await bot.telegram.editMessageCaption(ctx.chat.id, replyMsgId, null, `🎒 **Captured by ${ctx.from.first_name}!** 🎉\n\n**Character Name:** ${activeSpawn.fullName}\n**Rarity:** ${activeSpawn.rarityName}`, {
                parse_mode: 'Markdown'
            });
        } catch(e){}

        return ctx.reply(`🎉 **Congratulations ${ctx.from.first_name}!** You guessed correctly and captured **${activeSpawn.fullName}**!`).catch(() => {});
    } else {
        return ctx.reply('❌ Wrong name! Try again.').catch(() => {});
    }
});

bot.action('admin_start_add', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('Denied!');
    ctx.answerCbQuery();
    adminState[ctx.from.id] = { step: 'WAITING_FOR_FILE', data: {} };
    return ctx.reply('Please send or forward the Video or Photo for this edit:').catch(() => {});
});

bot.action(/set_rarity_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('Denied!');
    const selectedRarity = ctx.match[1];
    const userState = adminState[ctx.from.id];
    
    if (!userState || !userState.data || !userState.data.file) {
        return ctx.answerCbQuery('Session expired.', { show_alert: true });
    }
    
    userState.data.rarity = selectedRarity;
    const db = readDB();
    const nextId = db.animeEdits.length + 1; // تنظیم شروع آیدی دقیقاً از ۱ و به ترتیب تعداد کاراکترها
    userState.data.id = nextId;

    db.animeEdits.push(userState.data);
    writeDB(db);
    adminState
