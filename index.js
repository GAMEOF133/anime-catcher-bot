const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');

// 1. Configuration
const BOT_TOKEN = '8380688406:AAH4lWrMOxlfSSvB__1O8zDuQdPE_NwgMZg'; 
const ADMIN_IDS = [7334867757, 6155765664]; // تعریف لیست ادمین‌هاایدی‌های ادمین
const bot = new Telegraf(BOT_TOKEN, { 
    handlerTimeout: 90000 
});

const DB_PATH = '/data/db.json';

function initDatabase() {
    try {
        if (!fs.existsSync('/data')) fs.mkdirSync('/data', { recursive: true });
        if (!fs.existsSync(DB_PATH)) {
            const initialDB = { activeGroups: [], animeEdits: [], userBackpacks: {}, userGeo: {} };
            fs.writeFileSync(DB_PATH, JSON.stringify(initialDB, null, 2), 'utf8');
        }
    } catch (err) { console.error('Database Initialization Error:', err.message); }
}

initDatabase();

function readDB() {
    try {
        if (!fs.existsSync(DB_PATH)) return { activeGroups: [], animeEdits: [], userBackpacks: {}, userGeo: {} };
        const data = fs.readFileSync(DB_PATH, 'utf8');
        const parsed = JSON.parse(data);
        if (!parsed.activeGroups) parsed.activeGroups = [];
        if (!parsed.animeEdits) parsed.animeEdits = [];
        if (!parsed.userBackpacks) parsed.userBackpacks = {};
        if (!parsed.userGeo) parsed.userGeo = {}; // اضافه شدن Geo
        return parsed;
    } catch (err) { return { activeGroups: [], animeEdits: [], userBackpacks: {}, userGeo: {} }; }
}

function writeDB(data) {
    try {
        if (!fs.existsSync('/data')) fs.mkdirSync('/data', { recursive: true });
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) { console.error('Failed to write to DB:', err.message); }
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
let pendingGifts = {}; 

function getRandomEdit() {
    const db = readDB();
    if (!db.animeEdits || db.animeEdits.length === 0) return null;
    const roll = Math.random() * 100;
    let currentChance = 0;
    let selectedRarity = 'RARE';
    for (const [key, value] of Object.entries(RARITIES)) {
        currentChance += value.chance;
        if (roll <= currentChance) { selectedRarity = key; break; }
    }
    const pool = db.animeEdits.filter(edit => edit.rarity === selectedRarity);
    return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : db.animeEdits[0];
}

// تابع اصلاح شده برای پشتیبانی از آیدی خاص
async function spawnInChat(chatId, specificId = null) {
    try {
        const db = readDB();
        let edit;
        if (specificId) {
            edit = db.animeEdits.find(e => Number(e.id) === specificId);
        } else {
            edit = getRandomEdit();
        }
        if (!edit) return;

        const rarityInfo = RARITIES[edit.rarity] || RARITIES.RARE;
        const captionText = `✨ **An Anime Edit Appeared!** ✨\n\n**Anime:** ${edit.anime}\n**ID:** ${edit.id}\n**Rarity:** ${rarityInfo.name}\n\n🗣️ **Catch with:** /cap ${edit.name.split(' ')[0]}`;

        let sentMsg;
        if (edit.type === 'video') sentMsg = await bot.telegram.sendVideo(chatId, edit.file, { caption: captionText, parse_mode: 'Markdown' });
        else if (edit.type === 'animation') sentMsg = await bot.telegram.sendAnimation(chatId, edit.file, { caption: captionText, parse_mode: 'Markdown' });
        else sentMsg = await bot.telegram.sendPhoto(chatId, edit.file, { caption: captionText, parse_mode: 'Markdown' });

        activeSpawns[sentMsg.message_id] = { id: Number(edit.id), name: edit.name.trim().toLowerCase(), fullName: edit.name, rarityName: rarityInfo.name, rarityKey: edit.rarity, anime: edit.anime, captured: false };
    } catch (error) { console.error(`Error:`, error.message); }
}

function spawnEditInGroups() {
    const db = readDB();
    db.activeGroups.forEach((chatId) => spawnInChat(chatId).catch(()=>{}));
}

// دستور جدید Geo
bot.command('geo', (ctx) => {
    const db = readDB();
    const geo = db.userGeo[ctx.from.id] || 0;
    ctx.reply(`💰 **Your Balance:** ${geo} Geo`);
});

// دستور Spawn آپدیت شده
bot.command('spawn', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const args = ctx.message.text.replace('/spawn', '').trim();
    const specificId = args ? parseInt(args) : null;
    spawnInChat(ctx.chat.id, specificId);
});

// دستور Cap اصلاح شده (افزودن Geo بعد از کپچر)
bot.command('cap', async (ctx) => {
    try {
        if (ctx.chat.type === 'private') return;
        if (!ctx.message.reply_to_message) return;
        const activeSpawn = activeSpawns[ctx.message.reply_to_message.message_id];
        if (!activeSpawn || activeSpawn.captured) return;

        const guess = ctx.message.text.replace('/cap', '').trim().toLowerCase();
        if (guess === activeSpawn.name) {
            activeSpawn.captured = true;
            const db = readDB();
            const userId = ctx.from.id;
            
            // ثبت در بک‌پک
            if (!db.userBackpacks[userId]) db.userBackpacks[userId] = [];
            db.userBackpacks[userId].push({ id: activeSpawn.id, name: activeSpawn.fullName, anime: activeSpawn.anime, rarity: activeSpawn.rarityKey, caughtAt: new Date().toISOString() });
            
            // دادن 100 Geo به عنوان پاداش
            db.userGeo[userId] = (db.userGeo[userId] || 0) + 100;
            writeDB(db);

            await bot.telegram.editMessageCaption(ctx.chat.id, ctx.message.reply_to_message.message_id, undefined, `🎒 **Captured by ${ctx.from.first_name}!** 🎉\n\n**Character:** ${activeSpawn.fullName}\n**Reward:** +100 Geo`, { parse_mode: 'Markdown' });
            return ctx.reply(`🎉 **Congratulations!** You got ${activeSpawn.fullName} and +100 Geo!`).catch(() => {});
        }
    } catch(e) {}
});

// --- بقیه دستورات قبلی شما (start, setup, gift, manage, etc.) دقیقاً اینجا قرار می‌گیرند ---
// (از دستور start تا انتهای کد قبل از setInterval را اینجا اضافه کنید)

// تایمر به 10 دقیقه (600,000 میلی‌ثانیه) تغییر یافت
setInterval(spawnEditInGroups, 600000);

const http = require('http');
http.createServer((req, res) => { res.write("Bot is Running!"); res.end(); }).listen(process.env.PORT || 3000);

bot.launch().then(() => console.log('✅ Bot Updated: ID Spawn, Geo System & 10m Interval Active!'));
