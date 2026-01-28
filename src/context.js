function getTimeContext() {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();

    let timeOfDay;
    if (hour >= 5 && hour < 12) {
        timeOfDay = 'morning';
    } else if (hour >= 12 && hour < 17) {
        timeOfDay = 'afternoon';
    } else if (hour >= 17 && hour < 21) {
        timeOfDay = 'evening';
    } else {
        timeOfDay = 'night';
    }

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[day];
    const isWeekend = day === 0 || day === 6;

    const timeStr = now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });

    return {
        timeOfDay,
        dayName,
        isWeekend,
        hour,
        timeStr,
        formatted: `${dayName} ${timeOfDay}, ${timeStr}`
    };
}

function getTimeSince(date) {
    if (!date) return null;

    const then = new Date(date);
    const now = new Date();
    const diffMs = now - then;

    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`;
    if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) !== 1 ? 's' : ''} ago`;

    return `${Math.floor(days / 30)} month${Math.floor(days / 30) !== 1 ? 's' : ''} ago`;
}

function getServerContext(msg) {
    if (!msg.guild) {
        return null;
    }

    return {
        serverName: msg.guild.name,
        channelName: msg.channel.name,
        channelTopic: msg.channel.topic || null,
        formatted: `#${msg.channel.name} in ${msg.guild.name}`
    };
}

function getConversationState(messages, myUserId) {
    if (!messages || messages.length === 0) {
        return {
            isNewConversation: true,
            lastExchangeGap: null,
            recentParticipants: []
        };
    }

    let lastExchangeGap = null;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.createdAt) {
        lastExchangeGap = getTimeSince(lastMsg.createdAt);
    }

    let isNewConversation = false;
    if (messages.length < 3) {
        isNewConversation = true;
    } else if (lastMsg && lastMsg.createdAt) {
        const hoursSince = (Date.now() - new Date(lastMsg.createdAt).getTime()) / 3600000;
        isNewConversation = hoursSince > 4;
    }

    const participantSet = new Set();
    for (const msg of messages.slice(-10)) {
        if (msg.author && msg.author.id !== myUserId) {
            participantSet.add(msg.author.username || msg.author.tag);
        }
    }
    const recentParticipants = [...participantSet];

    return {
        isNewConversation,
        lastExchangeGap,
        recentParticipants
    };
}

function buildContextString(msg, recentMessages, myUserId, lastSeen) {
    const time = getTimeContext();
    const server = getServerContext(msg);
    const convo = getConversationState(recentMessages, myUserId);

    let parts = [];

    parts.push(time.formatted);

    if (lastSeen) {
        const lastSeenStr = getTimeSince(lastSeen);
        if (lastSeenStr && lastSeenStr !== 'just now') {
            parts.push(`Last message from them: ${lastSeenStr}`);
        }
    }

    if (server) {
        parts.push(`[In ${server.formatted}]`);
        if (server.channelTopic) {
            parts.push(`Channel topic: ${server.channelTopic}`);
        }
    }

    if (convo.isNewConversation) {
        parts.push('(Starting fresh conversation)');
    }

    if (server && convo.recentParticipants.length > 1) {
        parts.push(`Recent participants: ${convo.recentParticipants.join(', ')}`);
    }

    return parts.join('\n');
}

module.exports = {
    getTimeContext,
    getTimeSince,
    getServerContext,
    getConversationState,
    buildContextString
};