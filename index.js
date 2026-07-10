const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');

// 1. Configuration
const BOT_TOKEN = '8380688406:AAH4lWrMOxlfSSvB__1O8zDuQdPE_NwgMZg'; 
const ADMIN_ID = 7334867757; 

const bot = new Telegraf(BOT_TOKEN, { 
    handlerTimeout: 90000 
});

// Paths - متصل به هارد دائمی ریل‌وی
const DB_PATH = '/data/db.json';

// ساخت پوشه و فایل دیتابیس در صورت عدم وجود
function initDatabase() {
    try {
        if (!fs.existsSync('/data')) {
            fs.mkdirSync('/data', { recursive: true });
        }
        if (!fs.existsSync(DB_PATH)) {
            const initialDB = { activeGroups: [], animeEdits: [], userBackpacks: {} };
            fs.writeFileSync(DB_PATH, JSON.stringify(initialDB, null, 2), 'utf8');
            console.log('Fresh database initialized on Railway Volume.');
        }
    } catch (err) {
        console.error('Database Initialization Error:', err.message);
    }
}

initDatabase();

function readDB() {
    try {
        if (!fs.existsSync(DB_PATH)) {
            return { activeGroups: [], animeEdits: [], userBackpacks: {} };
        }
        const data = fs.readFileSync(DB_PATH, 'utf8');
        const parsed = JSON.parse(data);
        
        if (!parsed.activeGroups) parsed.activeGroups = [];
        if (!parsed.animeEdits) parsed.animeEdits = [];
        if (!parsed.userBackpacks) parsed.userBackpacks = {};
        
        return parsed;
    } catch (err) {
        console.error('Read DB Error:', err.message);
        return { activeGroups: [], animeEdits: [], userBackpacks: {} };
    }
}

function writeDB(data) {
    try {
        if (!fs.existsSync('/data')) {
            fs.mkdirSync('/data', { recursive: true });
        }
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.error('Failed to write to DB:', err.message);
    }
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
let pendingGifts = {}; // برای ذخیره موقت وضعیت هدیه‌ها قبل از تایید

function getRandomEdit() {
    const db = readDB();
    if (!db.animeEdits || db.animeEdits.length === 0) return null;

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
    try {
        const edit = getRandomEdit();
        if (!edit) return;

        const rarityInfo = RARITIES[edit.rarity] || RARITIES.RARE;
        const captionText = `✨ **An Anime Edit Appeared!** ✨\n\n**Anime:** ${edit.anime}\n**Rarity:** ${rarityInfo.name}\n\n🗣️ **How to catch?** Reply to this message with:\n/cap CharacterName`;

        let sentMsg;
        if (edit.type === 'video') {
            sentMsg = await bot.telegram.sendVideo(chatId, edit.file, { caption: captionText, parse_mode: 'Markdown' });
        } else if (edit.type === 'animation') {
            sentMsg = await bot.telegram.sendAnimation(chatId, edit.file, { caption: captionText, parse_mode: 'Markdown' });
        } else {
            sentMsg = await bot.telegram.sendPhoto(chatId, edit.file, { caption: captionText, parse_mode: 'Markdown' });
        }

        activeSpawns[sentMsg.message_id] = {
            id: Number(edit.id), 
            name: edit.name.trim().toLowerCase(),
            fullName: edit.name,
            rarityName: rarityInfo.name,
            rarityKey: edit.rarity,
            anime: edit.anime,
            captured: false
        };
    } catch (error) {
        console.error(`Failed to send spawn to chat ${chatId}:`, error.message);
    }
}

function spawnEditInGroups() {
    try {
        const db = readDB();
        if (!db.activeGroups || db.activeGroups.length === 0) return;
        db.activeGroups.forEach((chatId) => spawnInChat(chatId).catch(()=>{}));
    } catch(e) {}
}

bot.start((ctx) => {
    try {
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
        ctx.reply('Welcome to Anime Catcher Bot! Add me to a group and send /setup to activate.\nUse /backpack to see your collection.').catch(() => {});
    } catch(e) {}
});

bot.command('spawn', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const db = readDB();
    if (!db.animeEdits || db.animeEdits.length === 0) {
        return ctx.reply('❌ دیتابیس خالی است! ابتدا در پی‌وی ربات از منوی ادمین یک ادیت اضافه کنید تا سیستم فعال شود.').catch(()=>{});
    }
    spawnInChat(ctx.chat.id).catch((err) => {
        ctx.reply(`Error during spawn: ${err.message}`).catch(()=>{});
    });
});

bot.command('setup', (ctx) => {
    try {
        if (ctx.chat.type === 'private') return ctx.reply('This command only works in groups!').catch(()=>{});
        const chatId = ctx.chat.id;
        const db = readDB();
        if (!db.activeGroups.includes(chatId)) {
            db.activeGroups.push(chatId);
            writeDB(db);
        }
        ctx.reply('✅ Auto spawn system active! An edit will spawn every 5 minutes.').catch(() => {});
    } catch(e) {}
});

bot.command('gift', async (ctx) => {
    try {
        if (ctx.chat.type === 'private') return ctx.reply('This command only works in groups!').catch(()=>{});
        
        if (!ctx.message.reply_to_message) {
            return ctx.reply('⚠️ Please reply to the user you want to gift the edit to!').catch(() => {});
        }

        const targetUser = ctx.message.reply_to_message.from;
        const senderId = ctx.from.id;

        if (targetUser.id === senderId) {
            return ctx.reply('❌ You cannot gift an edit to yourself!').catch(() => {});
        }
        if (targetUser.is_bot) {
            return ctx.reply('❌ You cannot gift edits to bots!').catch(() => {});
        }

        const msgText = ctx.message.text || '';
        const args = msgText.replace('/gift', '').trim();

        if (!args) {
            return ctx.reply('⚠️ Please provide the Edit ID after /gift (e.g., /gift 1)').catch(() => {});
        }

        const editId = parseInt(args);
        if (isNaN(editId)) {
            return ctx.reply('⚠️ Edit ID must be a valid number!').catch(() => {});
        }

        const db = readDB();
        const senderItems = db.userBackpacks[senderId] || [];
        
        // پیدا کردن آیتم در بک‌پک فرستنده
        const itemIndex = senderItems.findIndex(item => Number(item.id) === editId);

        if (itemIndex === -1) {
            return ctx.reply(`❌ You don't have an edit with ID ${editId} in your /backpack!`).catch(() => {});
        }

        const editToGift = senderItems[itemIndex];
        const giftKey = `${ctx.chat.id}_${ctx.message.message_id}`;

        // ذخیره اطلاعات هدیه به صورت موقت
        pendingGifts[giftKey] = {
            senderId: senderId,
            senderName: ctx.from.first_name,
            targetId: targetUser.id,
            targetName: targetUser.first_name,
            editId: editId,
            editData: editToGift
        };

        const keyboard = [
            [
                { text: '🟢 Yes', callback_data: `gift_confirm_${giftKey}` },
                { text: '🔴 No', callback_data: `gift_cancel_${giftKey}` }
            ]
        ];

        return ctx.reply(`🎁 **Gift Confirmation**\n\n${ctx.from.first_name}, do you really want to gift **${editToGift.name}** (ID: ${editId}) to **${targetUser.first_name}**?`, {
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'Markdown'
        }).catch(() => {});

    } catch (e) {
        console.error('Error in gift command:', e.message);
    }
});

bot.action(/gift_confirm_(.+)/, (ctx) => {
    try {
        const giftKey = ctx.match[1];
        const giftData = pendingGifts[giftKey];

        if (!giftData) {
            return ctx.answerCbQuery('This gift session has expired. ❌', { show_alert: true }).catch(()=>{});
        }

        // فقط فرستنده هدیه اجازه دارد تاییدش کند
        if (ctx.from.id !== giftData.senderId) {
            return ctx.answerCbQuery('❌ Only the person sending the gift can confirm this!', { show_alert: true }).catch(()=>{});
        }

        const db = readDB();
        const senderItems = db.userBackpacks[giftData.senderId] || [];
        
        // چک کردن مجدد وجود آیتم برای امنیت بیشتر
        const itemIndex = senderItems.findIndex(item => Number(item.id) === giftData.editId);

        if (itemIndex === -1) {
            delete pendingGifts[giftKey];
            ctx.answerCbQuery().catch(()=>{});
            return ctx.editMessageText('❌ Transaction failed: Item is no longer in your backpack.').catch(() => {});
        }

        // ۱. حذف از بک‌پک فرستنده
        const [movedItem] = senderItems.splice(itemIndex, 1);
        db.userBackpacks[giftData.senderId] = senderItems;

        // ۲. اضافه کردن به بک‌پک گیرنده
        if (!db.userBackpacks[giftData.targetId]) {
            db.userBackpacks[giftData.targetId] = [];
        }
        db.userBackpacks[giftData.targetId].push(movedItem);

        writeDB(db);
        delete pendingGifts[giftKey];

        ctx.answerCbQuery('Gift sent successfully! 🎉').catch(()=>{});
        return ctx.editMessageText(`🎁 **Gift Delivered!**\n\n🎉 **${giftData.senderName}** successfully gifted **${giftData.editData.name}** (ID: ${giftData.editId}) to **${giftData.targetName}**!`).catch(() => {});

    } catch (e) {
        console.error('Error in gift confirm action:', e.message);
    }
});

bot.action(/gift_cancel_(.+)/, (ctx) => {
    try {
        const giftKey = ctx.match[1];
        const giftData = pendingGifts[giftKey];

        if (!giftData) {
            return ctx.answerCbQuery('This gift session has expired. ❌', { show_alert: true }).catch(()=>{});
        }

        // فقط فرستنده هدیه اجازه دارد لغوش کند
        if (ctx.from.id !== giftData.senderId) {
            return ctx.answerCbQuery('❌ Only the person sending the gift can cancel this!', { show_alert: true }).catch(()=>{});
        }

        delete pendingGifts[giftKey];
        ctx.answerCbQuery('Gift cancelled. 🔴').catch(()=>{});
        return ctx.editMessageText(`🔴 **Gift Cancelled:**\n${giftData.senderName} decided not to send the gift.`).catch(() => {});

    } catch (e) {
        console.error('Error in gift cancel action:', e.message);
    }
});

bot.command('see', async (ctx) => {
    try {
        const msgText = ctx.message.text || '';
        const args = msgText.replace('/see', '').trim();
        
        if (!args) {
            return ctx.reply('⚠️ Please provide the Edit ID after /see (e.g., /see 1)').catch(() => {});
        }

        const editId = parseInt(args);
        if (isNaN(editId)) {
            return ctx.reply('⚠️ Edit ID must be a valid number!').catch(() => {});
        }

        const db = readDB();
        const edit = db.animeEdits.find(e => Number(e.id) === editId);

        if (!edit) {
            return ctx.reply(`❌ No edit found with ID: ${editId}`).catch(() => {});
        }

        let owners = [];
        if (db.userBackpacks) {
            for (const [userId, items] of Object.entries(db.userBackpacks)) {
                const count = items.filter(item => Number(item.id) === editId).length;
                if (count > 0) {
                    owners.push(`${userId} (${count} time${count > 1 ? 's' : ''})`);
                }
            }
        }

        const ownersList = owners.length > 0 ? owners.join(', ') : 'None';
        const rarityInfo = RARITIES[edit.rarity] ? RARITIES[edit.rarity].name : edit.rarity;

        const captionText = `ℹ️ **Anime Edit Info (View Only)**\n\n**ID:** ${edit.id}\n**Character:** ${edit.name}\n**Anime:** ${edit.anime}\n**Rarity:** ${rarityInfo}\n\n👥 **Users:** ${ownersList}`;

        if (edit.type === 'video') {
            await bot.telegram.sendVideo(ctx.chat.id, edit.file, { caption: captionText, parse_mode: 'Markdown' });
        } else if (edit.type === 'animation') {
            await bot.telegram.sendAnimation(ctx.chat.id, edit.file, { caption: captionText, parse_mode: 'Markdown' });
        } else {
            await bot.telegram.sendPhoto(ctx.chat.id, edit.file, { caption: captionText, parse_mode: 'Markdown' });
        }

    } catch (e) {
        console.error('Error in see command:', e.message);
    }
});

bot.command('get', async (ctx) => {
    try {
        if (ctx.from.id !== ADMIN_ID) return;

        const msgText = ctx.message.text || '';
        const args = msgText.replace('/get', '').trim();
        
        if (!args) {
            return ctx.reply('⚠️ Please provide the Edit ID after /get (e.g., /get 2)').catch(() => {});
        }

        const editId = parseInt(args);
        if (isNaN(editId)) {
            return ctx.reply('⚠️ Edit ID must be a valid number!').catch(() => {});
        }

        const db = readDB();
        const edit = db.animeEdits.find(e => Number(e.id) === editId);

        if (!edit) {
            return ctx.reply(`❌ No edit found with ID: ${editId} in database.`).catch(() => {});
        }

        if (!db.userBackpacks[ADMIN_ID]) {
            db.userBackpacks[ADMIN_ID] = [];
        }

        db.userBackpacks[ADMIN_ID].push({
            id: Number(edit.id), 
            name: edit.name,
            anime: edit.anime,
            rarity: edit.rarity,
            caughtAt: new Date().toISOString()
        });
        
        writeDB(db);

        const rarityName = RARITIES[edit.rarity] ? RARITIES[edit.rarity].name : edit.rarity;
        return ctx.reply(`🎁 **Admin Action:**\nSuccessfully added **${edit.name}** (ID: ${edit.id} - ${rarityName}) to your /backpack!`).catch(() => {});

    } catch (e) {
        console.error('Error in get command:', e.message);
    }
});

bot.command('backpack', (ctx) => {
    try {
        const userId = ctx.from.id;
        const db = readDB();
        
        const userItems = db.userBackpacks[userId] || [];

        if (userItems.length === 0) {
            return ctx.reply(`🎒 **${ctx.from.first_name}'s Backpack**\n\nYour backpack is currently empty! Catch some anime edits in groups using /cap.`, { parse_mode: 'Markdown' }).catch(() => {});
        }

        let report = `🎒 **${ctx.from.first_name}'s Backpack (${userItems.length} items):**\n\n`;
        userItems.forEach((item, index) => {
            const rarityName = RARITIES[item.rarity] ? RARITIES[item.rarity].name : item.rarity;
            report += `${index + 1}. **${item.name}** - ${item.anime} (ID: ${item.id} - ${rarityName})\n`;
        });

        return ctx.reply(report, { parse_mode: 'Markdown' }).catch(() => {});
    } catch (e) {
        console.error('Backpack error:', e.message);
    }
});

bot.command('cap', async (ctx) => {
    try {
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

        let msgText = ctx.message.text || '';
        const guess = msgText.replace('/cap', '').trim().toLowerCase();
        
        if (!guess) {
            return ctx.reply('⚠️ Please provide the character name after /cap (e.g., /cap Diego)').catch(() => {});
        }

        if (guess === activeSpawn.name) {
            activeSpawn.captured = true;
            
            const userId = ctx.from.id;
            const db = readDB();
            
            if (!db.userBackpacks[userId]) db.userBackpacks[userId] = [];
            
            db.userBackpacks[userId].push({
                id: Number(activeSpawn.id), 
                name: activeSpawn.fullName,
                anime: activeSpawn.anime,
                rarity: activeSpawn.rarityKey,
                caughtAt: new Date().toISOString()
            });
            writeDB(db);
            
            try {
                await bot.telegram.editMessageCaption(ctx.chat.id, replyMsgId, undefined, `🎒 **Captured by ${ctx.from.first_name}!** 🎉\n\n**Character Name:** ${activeSpawn.fullName}\n**Rarity:** ${activeSpawn.rarityName}`, {
                    parse_mode: 'Markdown'
                });
            } catch(e){}

            return ctx.reply(`🎉 **Congratulations ${ctx.from.first_name}!** You guessed correctly and captured **${activeSpawn.fullName}**! It has been added to your /backpack.`).catch(() => {});
        } else {
            return ctx.reply('❌ Wrong name! Try again.').catch(() => {});
        }
    } catch(e) {
        console.error('Error in cap command:', e.message);
    }
});

bot.action('admin_start_add', (ctx) => {
    try {
        if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('Denied!').catch(()=>{});
        ctx.answerCbQuery().catch(()=>{});
        adminState[ctx.from.id] = { step: 'WAITING_FOR_FILE', data: {} };
        return ctx.reply('Please send or forward the Video or Photo for this edit:').catch(() => {});
    } catch(e) {}
});

bot.action(/set_rarity_(.+)/, async (ctx) => {
    try {
        if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('Denied!').catch(()=>{});
        const selectedRarity = ctx.match[1];
        const userState = adminState[ctx.from.id];
        
        if (!userState || !userState.data || !userState.data.file) {
            return ctx.answerCbQuery('Session expired.', { show_alert: true }).catch(()=>{});
        }
        
        userState.data.rarity = selectedRarity;
        const db = readDB();
        
        let nextId = 1;
        if (db.animeEdits && db.animeEdits.length > 0) {
            const ids = db.animeEdits.map(e => Number(e.id)).filter(id => !isNaN(id));
            if (ids.length > 0) {
                nextId = Math.max(...ids) + 1;
            }
        }
        userState.data.id = nextId;

        db.animeEdits.push(userState.data);
        writeDB(db);
        adminState[ctx.from.id] = null;

        ctx.answerCbQuery().catch(()=>{});
        return ctx.reply(`✅ Successfully added!\n\nCode ID: ${userState.data.id}\nCharacter: ${userState.data.name}\nAnime: ${userState.data.anime}\nRarity: ${RARITIES[selectedRarity].name}`).catch(() => {});
    } catch(e) {}
});

bot.action(/admin_manage_list_(\d+)/, (ctx) => {
    try {
        if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('Denied!').catch(()=>{});
        ctx.answerCbQuery().catch(()=>{});
        
        const page = parseInt(ctx.match[1]);
        const db = readDB();
        const edits = db.animeEdits || [];

        if (edits.length === 0) {
            return ctx.reply('No edits found in database.').catch(() => {});
        }

        const itemsPerPage = 5;
        const startIdx = page * itemsPerPage;
        const pageItems = edits.slice(startIdx, startIdx + itemsPerPage);

        let keyboard = [];
        pageItems.forEach((item) => {
            keyboard.push([
                { text: `🆔 ${item.id} | ${item.name} (${RARITIES[item.rarity].name.split(' ')[0]})`, callback_data: `manage_view_${item.id}` }
            ]);
        });

        let navRow = [];
        if (page > 0) navRow.push({ text: '⬅️ Previous', callback_data: `admin_manage_list_${page - 1}` });
        if (startIdx + itemsPerPage < edits.length) navRow.push({ text: 'Next ➡️', callback_data: `admin_manage_list_${page + 1}` });
        if (navRow.length > 0) keyboard.push(navRow);

        keyboard.push([{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]);

        const text = `📂 **Manage Edits (Page ${page + 1}):**\nSelect any edit below to change Rarity or Delete it:`;
        if (ctx.callbackQuery && ctx.callbackQuery.message && ctx.callbackQuery.message.text) {
            ctx.editMessageText(text, { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' }).catch(() => {});
        } else {
            ctx.reply(text, { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' }).catch(() => {});
        }
    } catch(e) {}
});

bot.action(/manage_view_(\d+)/, (ctx) => {
    try {
        if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('Denied!').catch(()=>{});
        ctx.answerCbQuery().catch(()=>{});
        const editId = parseInt(ctx.match[1]);
        const db = readDB();
        const edit = db.animeEdits.find(e => Number(e.id) === editId);

        if (!edit) return ctx.reply('Edit not found!').catch(()=>{});

        const keyboard = [
            [{ text: '⭐ Change Rarity', callback_data: `manage_chrarity_${edit.id}` }],
            [{ text: '🗑️ Delete Edit', callback_data: `manage_delete_${edit.id}` }],
            [{ text: '🔙 Back to List', callback_data: 'admin_manage_list_0' }]
        ];

        ctx.reply(`📊 **Edit Details:**\n\n**ID:** ${edit.id}\n**Character:** ${edit.name}\n**Anime:** ${edit.anime}\n**Current Rarity:** ${RARITIES[edit.rarity].name}`, {
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'Markdown'
        }).catch(() => {});
    } catch(e) {}
});

bot.action(/manage_chrarity_(\d+)/, (ctx) => {
    try {
        if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('Denied!').catch(()=>{});
        ctx.answerCbQuery().catch(()=>{});
        const editId = ctx.match[1];
        
        const keyboard = Object.keys(RARITIES).map(key => [
            { text: RARITIES[key].name, callback_data: `apply_rarity_${editId}_${key}` }
        ]);
        keyboard.push([{ text: '❌ Cancel', callback_data: `manage_view_${editId}` }]);

        ctx.editMessageText('Select the new Rarity for this edit:', {
            reply_markup: { inline_keyboard: keyboard }
        }).catch(() => {});
    } catch(e) {}
});

bot.action(/apply_rarity_(\d+)_(.+)/, (ctx) => {
    try {
        if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('Denied!').catch(()=>{});
        const editId = parseInt(ctx.match[1]);
        const newRarity = ctx.match[2];

        const db = readDB();
        const editIndex = db.animeEdits.findIndex(e => Number(e.id) === editId);

        if (editIndex !== -1) {
            db.animeEdits[editIndex].rarity = newRarity;
            writeDB(db);
            ctx.answerCbQuery('Rarity updated successfully! ✅').catch(()=>{});
        } else {
            ctx.answerCbQuery('Error updating.').catch(()=>{});
        }
        
        return ctx.editMessageText('✅ Rarity updated successfully!', {
            reply_markup: { inline_keyboard: [[{ text: '🔙 Return', callback_data: `manage_view_${editId}` }]] }
        }).catch(() => {});
    } catch(e) {}
});

bot.action(/manage_delete_(\d+)/, (ctx) => {
    try {
        if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('Denied!').catch(()=>{});
        const editId = parseInt(ctx.match[1]);

        const db = readDB();
        db.animeEdits = db.animeEdits.filter(e => Number(e.id) !== editId);
        writeDB(db);

        ctx.answerCbQuery('Deleted successfully! 🗑️').catch(()=>{});
        ctx.editMessageText('🗑️ The edit has been completely deleted from database.', {
            reply_markup: { inline_keyboard: [[{ text: '🔙 Back to List', callback_data: 'admin_manage_list_0' }]] }
        }).catch(() => {});
    } catch(e) {}
});

bot.action('back_to_menu', (ctx) => {
    try {
        if (ctx.from.id !== ADMIN_ID) return;
        ctx.answerCbQuery().catch(()=>{});
        ctx.editMessageText('Welcome back Admin! Choose an option:', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '➕ Add New Edit', callback_data: 'admin_start_add' }],
                    [{ text: '📂 Manage Edits (Edit/Delete)', callback_data: 'admin_manage_list_0' }]
                ]
            }
        }).catch(() => {});
    } catch(e) {}
});

bot.on('message', async (ctx) => {
    try {
        if (ctx.chat.type !== 'private' || ctx.from.id !== ADMIN_ID) return;
        const userState = adminState[ctx.from.id];
        if (!userState) return;

        if (userState.step === 'WAITING_FOR_FILE') {
            let fileId = null;
            let fileType = null;

            if (ctx.message.video) { fileId = ctx.message.video.file_id; fileType = 'video'; }
            else if (ctx.message.photo) { fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id; fileType = 'photo'; }
            else if (ctx.message.animation) { fileId = ctx.message.animation.file_id; fileType = 'animation'; }

            if (!fileId) return ctx.reply('Invalid format! Please send a valid Video, GIF, or Photo:').catch(() => {});

            userState.data.file = fileId;
            userState.data.type = fileType;
            userState.step = 'WAITING_FOR_NAME';
            return ctx.reply('What is the Character Name?').catch(() => {});
        }

        if (userState.step === 'WAITING_FOR_NAME') {
            if (!ctx.message.text) return ctx.reply('Please type a text name:').catch(() => {});
            userState.data.name = ctx.message.text;
            userState.step = 'WAITING_FOR_ANIME';
            return ctx.reply('What is the Anime Name?').catch(() => {});
        }

        if (userState.step === 'WAITING_FOR_ANIME') {
            if (!ctx.message.text) return ctx.reply('Please type a text name:').catch(() => {});
            userState.data.anime = ctx.message.text;
            userState.step = 'WAITING_FOR_RARITY';

            const buttons = Object.keys(RARITIES).map(key => [{ text: RARITIES[key].name, callback_data: `set_rarity_${key}` }]);
            return ctx.reply('Select the Rarity for this edit:', { reply_markup: { inline_keyboard: buttons } }).catch(() => {});
        }
    } catch(e) {}
});

setInterval(spawnEditInGroups, 300000);

const http = require('http');
http.createServer((req, res) => {
    res.write("Bot is Running!");
    res.end();
}).listen(process.env.PORT || 3000);

bot.launch().then(() => console.log('✅ ID System, Voluming and Gift System completely activated!'));

process.on('uncaughtException', (err) => {
    console.error('Caught exception: ', err);
});
process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at: Promise', p, 'reason:', reason);
});
