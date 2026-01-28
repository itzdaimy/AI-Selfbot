const config = require('../config.json');
const { getProfile, learnProfile, updateProfile, trackInteraction, updateLastSeen, buildProfileString } = require('./profiles');
const { buildContextString } = require('./context');
const { extractMemories, buildMemoryString } = require('./memory');
const { chat } = require('./ai');
const {
    getContext,
    getReplyTarget,
    transitionToEngaged,
    shouldContinueEngaging,
    hasNewMessages,
    disengage,
    startResponding,
    markResponseDone
} = require('./conversations');
const {
    trackBotMessage,
    buildServerUserString,
    buildServerContextString,
    getServerData
} = require('./servers');
const { checkForGifResponse, buildGifPrompt, parseGifResponse } = require('./gifs');

const engagementMonitors = new Map();

async function handleMessage(msg, client) {
    const isDM = !msg.guild;

    let systemPrompt = config.defaultPrompt;
    if (msg.guild && config.serverPrompts[msg.guild.id]) {
        systemPrompt = config.serverPrompts[msg.guild.id];
    }

    let userProfile = null;
    if (isDM) {
        userProfile = getProfile(msg.author.id);

        if (!userProfile) {
            console.log(`learning profile for ${msg.author.tag}`);
            userProfile = await learnProfile(msg.channel, msg.author.id, client.user.id);
        }
    }

    let messages = [];
    let rawMessages = [];
    try {
        const fetched = await msg.channel.messages.fetch({ limit: config.contextMessages + 1 });
        const sorted = [...fetched.values()].reverse();
        rawMessages = sorted;

        for (let m of sorted) {
            if (m.id === msg.id) continue;
            messages.push({
                role: m.author.id === client.user.id ? 'assistant' : 'user',
                content: m.content
            });
        }
    } catch (e) {
    }

    messages.push({
        role: 'user',
        content: msg.content
    });

    let fullSystem = systemPrompt;

    const contextStr = buildContextString(
        msg,
        rawMessages,
        client.user.id,
        userProfile?.lastSeen
    );
    if (contextStr) {
        fullSystem += '\n\n--- Context ---\n';
        fullSystem += contextStr;
    }

    if (isDM) {
        const memoryStr = buildMemoryString(msg.author.id);
        if (memoryStr) {
            fullSystem += '\n\n--- Memory ---\n';
            fullSystem += memoryStr;
        }
    }

    if (userProfile) {
        fullSystem += '\n\n--- Your relationship with this person ---\n';
        fullSystem += buildProfileString(userProfile);

        if (userProfile.examples && userProfile.examples.length > 0) {
            fullSystem += '\n\n--- Example exchanges ---\n';
            for (let ex of userProfile.examples.slice(0, 10)) {
                if (ex.them) {
                    fullSystem += `Them: ${ex.them}\nYou: ${ex.you}\n\n`;
                } else {
                    fullSystem += `You: ${ex.you}\n\n`;
                }
            }
        }
    }

    const gifPrompt = buildGifPrompt();
    if (gifPrompt) {
        fullSystem += gifPrompt;
    }

    msg.channel.sendTyping();
    const typingInterval = setInterval(() => {
        msg.channel.sendTyping();
    }, 5000);

    try {
        let response = await chat(fullSystem, messages);

        clearInterval(typingInterval);

        if (!response || response.trim() === '') {
            return;
        }

        let gifUrl = parseGifResponse(response);

        if (gifUrl === 'RETRY') {
            msg.channel.sendTyping();
            response = await chat(fullSystem, messages);
            gifUrl = null;
        }

        if (!gifUrl) {
            gifUrl = checkForGifResponse(msg.content, response);
        }

        const delay = config.delay.min + Math.random() * (config.delay.max - config.delay.min);
        await sleep(delay);

        if (gifUrl && gifUrl !== 'RETRY') {
            await msg.channel.send(gifUrl);
        } else {
            await msg.channel.send(response);
        }

        const location = isDM ? 'DMs' : `#${msg.channel.name}`;
        console.log(`replied to ${msg.author.tag} in ${location}`);

        if (isDM) {
            updateLastSeen(msg.author.id);

            if (config.memoryExtraction !== false) {
                const recentExchange = messages.slice(-4);
                recentExchange.push({ role: 'assistant', content: response });
                extractMemories(msg.author.id, recentExchange).catch(() => {});
            }

            const shouldUpdate = trackInteraction(msg.author.id);
            if (shouldUpdate) {
                updateProfile(msg.channel, msg.author.id, client.user.id).catch(() => {});
            }
        }

    } catch (err) {
        clearInterval(typingInterval);
        throw err;
    }
}

async function handleServerConversation(channelId, channel, client) {
    const context = getContext(channelId, client.user.id);
    if (!context || context.messages.length === 0) {
        disengage(channelId);
        return;
    }

    let systemPrompt = config.defaultPrompt;
    if (channel.guild && config.serverPrompts[channel.guild.id]) {
        systemPrompt = config.serverPrompts[channel.guild.id];
    }

    const participantCount = context.participants.length;
    let serverContext = `You are in a server chat (#${channel.name} in ${channel.guild.name}).\n`;
    serverContext += `${participantCount} user${participantCount > 1 ? 's are' : ' is'} talking to you.\n`;
    serverContext += 'Messages are formatted as [username]: message content.\n';
    serverContext += 'Respond naturally to the conversation. Address users by name if needed.';

    const serverStr = buildServerContextString(channel.guild.id);
    if (serverStr) {
        serverContext += '\n' + serverStr;
    }

    for (const userId of context.participants) {
        const userStr = buildServerUserString(channel.guild.id, userId);
        if (userStr) {
            serverContext += '\n\n' + userStr;
        }
    }

    let fullSystem = systemPrompt + '\n\n--- Server Context ---\n' + serverContext;

    const gifPrompt = buildGifPrompt();
    if (gifPrompt) {
        fullSystem += gifPrompt;
    }

    const messages = context.messages.map(m => ({
        role: m.role,
        content: m.content
    }));

    channel.sendTyping();
    const typingInterval = setInterval(() => {
        channel.sendTyping();
    }, 5000);

    try {
        let response = await chat(fullSystem, messages);

        clearInterval(typingInterval);

        if (!response || response.trim() === '') {
            disengage(channelId);
            return;
        }

        let gifUrl = parseGifResponse(response);

        if (gifUrl === 'RETRY') {
            channel.sendTyping();
            response = await chat(fullSystem, messages);
            gifUrl = null;
        }

        if (!gifUrl) {
            const lastUserMsg = context.messages.filter(m => m.role === 'user').pop();
            gifUrl = checkForGifResponse(lastUserMsg?.content || '', response);
        }

        const delay = config.delay.min + Math.random() * (config.delay.max - config.delay.min);
        await sleep(delay);

        if (gifUrl && gifUrl !== 'RETRY') {
            await channel.send(gifUrl);
        } else {
            await sendResponse(channel, channelId, client.user.id, response);
        }

        trackBotMessage(channel.guild.id, channel.guild.name, channelId);

        console.log(`replied in #${channel.name}`);

        transitionToEngaged(channelId);

        setupEngagementMonitor(channelId, channel, client);

    } catch (err) {
        clearInterval(typingInterval);
        disengage(channelId);
        throw err;
    }
}

async function handleDeadChat(channel, client) {
    const serverData = getServerData(channel.guild.id);

    let systemPrompt = config.defaultPrompt;
    if (config.serverPrompts[channel.guild.id]) {
        systemPrompt = config.serverPrompts[channel.guild.id];
    }

    let contextParts = [];
    contextParts.push(`You're in #${channel.name} in ${channel.guild.name}.`);
    contextParts.push(`The chat has been dead for a while and you want to say something.`);
    contextParts.push(`Don't announce that it's been quiet. Just start a conversation naturally.`);
    contextParts.push(`Maybe comment on something, ask a question, share a thought, or bring up something random.`);

    const serverStr = buildServerContextString(channel.guild.id);
    if (serverStr) {
        contextParts.push(serverStr);
    }

    if (serverData && serverData.users) {
        const activeUsers = Object.entries(serverData.users)
            .filter(([id, u]) => u.messageCount > 5)
            .slice(0, 5);

        if (activeUsers.length > 0) {
            contextParts.push(`Active people here: ${activeUsers.map(([id, u]) => u.username).join(', ')}`);
        }
    }

    const fullSystem = systemPrompt + '\n\n--- Context ---\n' + contextParts.join('\n');

    let recentMessages = [];
    try {
        const fetched = await channel.messages.fetch({ limit: 10 });
        const sorted = [...fetched.values()].reverse();

        for (let m of sorted) {
            recentMessages.push({
                role: m.author.id === client.user.id ? 'assistant' : 'user',
                content: m.content
            });
        }
    } catch (e) {
    }

    recentMessages.push({
        role: 'user',
        content: '[The chat has been quiet. Say something to start a conversation.]'
    });

    channel.sendTyping();
    const typingInterval = setInterval(() => {
        channel.sendTyping();
    }, 5000);

    try {
        const response = await chat(fullSystem, recentMessages);

        clearInterval(typingInterval);

        if (!response || response.trim() === '') {
            return;
        }

        const delay = config.delay.min + Math.random() * (config.delay.max - config.delay.min);
        await sleep(delay);

        await channel.send(response);

        trackBotMessage(channel.guild.id, channel.guild.name, channel.id);

        console.log(`revived #${channel.name}`);

    } catch (err) {
        clearInterval(typingInterval);
        throw err;
    }
}

async function sendResponse(channel, channelId, clientUserId, response) {
    const useReply = Math.random() < 0.4;

    if (useReply) {
        const replyTargetId = getReplyTarget(channelId, clientUserId);
        if (replyTargetId) {
            try {
                const targetMsg = await channel.messages.fetch(replyTargetId);
                await targetMsg.reply(response);
                return;
            } catch (e) {
            }
        }
    }

    await channel.send(response);
}

function setupEngagementMonitor(channelId, channel, client) {
    if (engagementMonitors.has(channelId)) {
        clearInterval(engagementMonitors.get(channelId));
    }

    const checkInterval = setInterval(async () => {
        if (!shouldContinueEngaging(channelId)) {
            clearInterval(checkInterval);
            engagementMonitors.delete(channelId);
            return;
        }

        if (!hasNewMessages(channelId, client.user.id)) {
            return;
        }

        if (!startResponding(channelId)) {
            return;
        }

        clearInterval(checkInterval);
        engagementMonitors.delete(channelId);

        const context = getContext(channelId, client.user.id);
        if (!context) {
            markResponseDone(channelId);
            return;
        }

        channel.sendTyping();
        const typingInterval = setInterval(() => {
            channel.sendTyping();
        }, 5000);

        try {
            let systemPrompt = config.defaultPrompt;
            if (channel.guild && config.serverPrompts[channel.guild.id]) {
                systemPrompt = config.serverPrompts[channel.guild.id];
            }

            const participantCount = context.participants.length;
            let serverContext = `You are in a server chat (#${channel.name} in ${channel.guild.name}).\n`;
            serverContext += `${participantCount} user${participantCount > 1 ? 's are' : ' is'} talking to you.\n`;
            serverContext += 'Messages are formatted as [username]: message content.\n';
            serverContext += 'Continue the conversation naturally.';

            const serverStr = buildServerContextString(channel.guild.id);
            if (serverStr) {
                serverContext += '\n' + serverStr;
            }

            let fullSystem = systemPrompt + '\n\n--- Server Context ---\n' + serverContext;

            const gifPromptEngagement = buildGifPrompt();
            if (gifPromptEngagement) {
                fullSystem += gifPromptEngagement;
            }

            const messages = context.messages.map(m => ({
                role: m.role,
                content: m.content
            }));

            let response = await chat(fullSystem, messages);

            clearInterval(typingInterval);

            if (!response || response.trim() === '') {
                markResponseDone(channelId);
                disengage(channelId);
                return;
            }

            let gifUrl = parseGifResponse(response);

            if (gifUrl === 'RETRY') {
                channel.sendTyping();
                response = await chat(fullSystem, messages);
                gifUrl = null;
            }

            if (!gifUrl) {
                const lastUserMsg = context.messages.filter(m => m.role === 'user').pop();
                gifUrl = checkForGifResponse(lastUserMsg?.content || '', response);
            }

            const delay = config.delay.min + Math.random() * (config.delay.max - config.delay.min);
            await sleep(delay);

            if (gifUrl && gifUrl !== 'RETRY') {
                await channel.send(gifUrl);
            } else {
                await sendResponse(channel, channelId, client.user.id, response);
            }

            trackBotMessage(channel.guild.id, channel.guild.name, channelId);

            transitionToEngaged(channelId);
            setupEngagementMonitor(channelId, channel, client);

        } catch (err) {
            clearInterval(typingInterval);
            markResponseDone(channelId);
            disengage(channelId);
        }

    }, 2000);

    engagementMonitors.set(channelId, checkInterval);

    setTimeout(() => {
        if (engagementMonitors.get(channelId) === checkInterval) {
            clearInterval(checkInterval);
            engagementMonitors.delete(channelId);
        }
    }, 120000);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { handleMessage, handleServerConversation, handleDeadChat };