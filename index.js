const { Telegraf, Scenes, session } = require('telegraf');
const fs = require('fs');
const path = require('path');

// 1. Configuration
const BOT_TOKEN = '8380688406:AAH4lWrMOxlfSSvB__1O8zDuQdPE_NwgMZg'; 
const ADMIN_ID = 7334867757; 

// در هاست خارجی نیازی به پروکسی و ایجنت نیست
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

// 2. Wizard Scene for Adding New Edits
const addEditWizard = new Scenes.WizardScene(
    'add_edit_wizard',
    (ctx) => {
        ctx.reply('Please send/forward the Video or Photo for this edit:').catch(() => {});
        ctx.scene.session.editData = {}; 
        return ctx.wizard.next();
    },
    (ctx) => {
        if (ctx.callbackQuery) return; 
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
            ctx.reply('Invalid format! Please send a valid Video, GIF, or Photo:').catch(() => {});
            return;
        }

        ctx.scene.session.editData.file = fileId;
        ctx.scene.session.editData.type = fileType;
        ctx.reply('What is the Character Name?').catch(() => {});
        return ctx.wizard.next();
    },
    (ctx) => {
        if (!ctx.message || !ctx.message.text) {
            ctx.reply('Please type a text name for the character:').catch(() => {});
            return;
        }
        ctx.scene.session.editData.name = ctx.message.text;
        ctx.reply('What is the Anime Name?').catch(() => {});
        return ctx.wizard.next();
    },
    (ctx) => {
        if (!ctx.message || !ctx.message.text) {
            ctx.reply('Please type a text name for the anime:').catch(() => {});
            return;
        }
        ctx.scene.session.editData.anime = ctx.message.text;

        const buttons = Object.keys(RARITIES).map(key => [{ text: RARITIES[key].name, callback_data: `set_rarity_${key}` }]);
        ctx.reply('Select the Rarity for this edit:', {
            reply_markup: { inline_keyboard: buttons }
        }).catch(() => {});
        return ctx.wizard.next();
    },
    async (ctx) => {
        return ctx.scene.leave();
    }
);

const stage = new Scenes.Stage([addEditWizard]);
bot.use(session());
bot.use(stage.middleware());

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
    return ctx.scene.enter('add_edit_wizard');
});

bot.action(/set_rarity_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('Denied!').catch(() => {});
    
    const selectedRarity = ctx.match[1];
    
    if (!ctx.scene.session || !ctx.scene.session.editData) {
        await ctx.answerCbQuery('Session expired. Please try again.').catch(() => {});
        return ctx.scene.leave();
    }
    
    const editData = ctx.scene.session.editData;
    editData.rarity = selectedRarity;

    const db = readDB();
    const nextId = db.animeEdits.length > 0 ? Math.max(...db.animeEdits.map(e => e.id)) + 1 : 1;
    editData.id = nextId;

    db.animeEdits.push(editData);
    writeDB(db);

    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply(`✅ Successfully added dynamically!\n\nCode ID: ${editData.id}\nCharacter: ${editData.name}\nAnime: ${editData.anime}\nRarity: ${RARITIES[selectedRarity].name}`).catch(() => {});
    
    return ctx.scene.leave();
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

// وب‌سایت‌های رایگان مثل رندر نیاز به یک پورت فعال برای بیدار ماندن دارند
const http = require('http');
http.createServer((req, res) => {
    res.write("Bot is Running!");
    res.end();
}).listen(process.env.PORT || 3000);

bot.launch().then(() => console.log('✅ Bot deployed on Host successfully!'));