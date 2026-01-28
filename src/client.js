const { Client } = require('discord.js-selfbot-v13');
const config = require('../config.json');
const { handleMessage, handleServerConversation, handleDeadChat } = require('./handler');
const {
    getConversation,
    startConversation,
    bufferMessage,
    isRelevant,
    transitionToResponding,
    getActiveChannels,
    State
} = require('./conversations');
const { trackUserMessage } = require('./servers');

const client = new Client();

let processing = [];
const maxQueue = 5;

client.on('ready', () => {
    console.log(`logged in as ${client.user.tag}`);
    startConversationPoller();
    startDeadChatChecker();
});

client.on('messageCreate', async (msg) => {
    if (msg.author.id === client.user.id) return;

    const isDM = !msg.guild;

    if (config.blacklist.users.includes(msg.author.id)) return;
    if (msg.guild && config.blacklist.servers.includes(msg.guild.id)) return;

    if (msg.guild) {
        trackUserMessage(
            msg.guild.id,
            msg.guild.name,
            msg.author.id,
            msg.author.username,
            msg.content,
            msg.channel.id
        );
    }

    const isMention = msg.mentions.has(client.user.id);

    if (isDM) {
        if (processing.length >= maxQueue) {
            processing.shift();
        }

        if (processing.includes(msg.id)) return;
        processing.push(msg.id);

        try {
            await handleMessage(msg, client);
        } catch (err) {
            console.error('msg error:', err.message);
        }

        processing = processing.filter(id => id !== msg.id);
        return;
    }

    if (isMention) {
        const convo = getConversation(msg.channel.id);
        if (!convo || convo.state === State.IDLE) {
            startConversation(msg.channel.id, msg);
        } else {
            bufferMessage(msg.channel.id, msg);
        }
        return;
    }

    const convo = getConversation(msg.channel.id);
    if (convo && isRelevant(msg.channel.id, msg, client.user.id)) {
        bufferMessage(msg.channel.id, msg);
    }
});

function startConversationPoller() {
    setInterval(async () => {
        const readyChannels = getActiveChannels();

        for (const channelId of readyChannels) {
            const convo = transitionToResponding(channelId);
            if (!convo) continue;

            try {
                const channel = await client.channels.fetch(channelId);
                if (channel) {
                    await handleServerConversation(channelId, channel, client);
                }
            } catch (err) {
                console.error('server convo error:', err.message);
            }
        }
    }, 500);
}

function startDeadChatChecker() {
    const deadChatConfig = config.serverChat?.deadChat;
    if (!deadChatConfig?.enabled) return;

    const checkInterval = deadChatConfig.checkInterval || 300000;

    setInterval(async () => {
        const { getDeadChats } = require('./servers');

        const minMessages = deadChatConfig.minBotMessages || 15;
        const idleMinutes = deadChatConfig.idleMinutes || 30;
        const chance = deadChatConfig.chance || 0.3;

        const deadChats = getDeadChats(minMessages, idleMinutes);

        for (const dead of deadChats) {
            if (Math.random() > chance) continue;

            try {
                const channel = await client.channels.fetch(dead.channelId);
                if (channel && channel.guild) {
                    await handleDeadChat(channel, client);
                    break;
                }
            } catch (err) {
            }
        }
    }, checkInterval);
}

function startClient() {
    client.login(process.env.discord_token);
}

module.exports = { startClient };