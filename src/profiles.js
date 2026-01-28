const fs = require('fs');
const path = require('path');
const config = require('../config.json');
const { chat } = require('./ai');

const profilesDir = path.join(__dirname, '..', 'data', 'profiles');

const interactionCounts = new Map();

function getProfile(userId) {
    const filePath = path.join(profilesDir, `${userId}.json`);

    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return null;
    }
}

function saveProfile(userId, profile) {
    const filePath = path.join(profilesDir, `${userId}.json`);

    if (!fs.existsSync(profilesDir)) {
        fs.mkdirSync(profilesDir, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(profile, null, 2));
}

function trackInteraction(userId) {
    const count = (interactionCounts.get(userId) || 0) + 1;
    interactionCounts.set(userId, count);

    const interval = config.learningInterval || 25;
    return count % interval === 0;
}

function getInteractionCount(userId) {
    return interactionCounts.get(userId) || 0;
}

async function learnProfile(channel, otherUserId, myUserId) {
    let messages = [];

    try {
        const fetched = await channel.messages.fetch({ limit: config.profileHistoryLimit });
        messages = [...fetched.values()].reverse();
    } catch (e) {
        return null;
    }

    if (messages.length < 5) {
        return null;
    }

    let convo = '';
    let examples = [];

    let yourMessages = [];
    let theirMessages = [];

    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        const content = m.content.trim();

        if (!content) continue;

        const who = m.author.id === myUserId ? 'You' : 'Them';
        convo += `${who}: ${content}\n`;

        if (m.author.id === myUserId && content.length > 5) {
            yourMessages.push(content);
        } else if (m.author.id === otherUserId && content.length > 5) {
            theirMessages.push(content);
        }

        if (examples.length < 25 && m.author.id === otherUserId && content.length > 3) {
            for (let j = i + 1; j < messages.length && j < i + 4; j++) {
                const next = messages[j];
                if (next.author.id === myUserId && next.content.trim().length > 3) {
                    examples.push({
                        them: content,
                        you: next.content.trim()
                    });
                    break;
                }
            }
        }
    }

    if (examples.length < 2 && yourMessages.length > 0) {
        examples = yourMessages.slice(0, 25).map(msg => ({ you: msg }));
    }

    const analysisPrompt = `Analyze this conversation between "You" and "Them". Return ONLY a JSON object with this structure (no other text):

{
  "summary": "2-3 sentence description of the relationship, dynamic, and typical tone",
  "style": {
    "formality": "casual/neutral/formal",
    "humor": "frequent/occasional/rare/none",
    "emoji": "heavy/light/none",
    "length": "short/medium/long"
  },
  "patterns": ["common phrases or words you use with them"],
  "relationship": "close friend/friend/acquaintance/coworker/family/romantic/other"
}

Base your analysis on the actual conversation content. Only include patterns that appear multiple times.`;

    try {
        const result = await chat(analysisPrompt, [{
            role: 'user',
            content: convo
        }]);

        if (!result) {
            return null;
        }

        let analysis;
        try {
            const cleaned = result.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
            analysis = JSON.parse(cleaned);
        } catch (parseErr) {
            analysis = {
                summary: result.trim(),
                style: { formality: 'casual', humor: 'occasional', emoji: 'light', length: 'short' },
                patterns: [],
                relationship: 'friend'
            };
        }

        const profile = {
            summary: analysis.summary || result.trim(),
            examples: examples,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            style: analysis.style || {
                formality: 'casual',
                humor: 'occasional',
                emoji: 'light',
                length: 'short'
            },
            patterns: analysis.patterns || [],
            relationship: analysis.relationship || 'friend',
            interactions: 0,
            lastSeen: new Date().toISOString()
        };

        saveProfile(otherUserId, profile);
        console.log(`profile saved for ${otherUserId}`);

        return profile;
    } catch (err) {
        return null;
    }
}

async function updateProfile(channel, otherUserId, myUserId) {
    const existing = getProfile(otherUserId);
    if (!existing) {
        return learnProfile(channel, otherUserId, myUserId);
    }

    let messages = [];
    try {
        const fetched = await channel.messages.fetch({ limit: config.profileHistoryLimit });
        messages = [...fetched.values()].reverse();
    } catch (e) {
        return existing;
    }

    if (messages.length < 10) {
        return existing;
    }

    let convo = '';
    let newExamples = [];

    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        const content = m.content.trim();
        if (!content) continue;

        const who = m.author.id === myUserId ? 'You' : 'Them';
        convo += `${who}: ${content}\n`;

        if (newExamples.length < 10 && m.author.id === otherUserId && content.length > 3) {
            for (let j = i + 1; j < messages.length && j < i + 4; j++) {
                const next = messages[j];
                if (next.author.id === myUserId && next.content.trim().length > 3) {
                    newExamples.push({
                        them: content,
                        you: next.content.trim()
                    });
                    break;
                }
            }
        }
    }

    const updatePrompt = `Here is the current profile analysis for this person:
${JSON.stringify({ summary: existing.summary, style: existing.style, patterns: existing.patterns, relationship: existing.relationship }, null, 2)}

Here is a recent conversation with them:
${convo}

Update the profile based on the new conversation. Return ONLY a JSON object:
{
  "summary": "updated 2-3 sentence summary",
  "style": {
    "formality": "casual/neutral/formal",
    "humor": "frequent/occasional/rare/none",
    "emoji": "heavy/light/none",
    "length": "short/medium/long"
  },
  "patterns": ["updated common phrases"],
  "relationship": "relationship type"
}

Keep existing insights that still apply, but update anything that has changed.`;

    try {
        const result = await chat(updatePrompt, [{
            role: 'user',
            content: 'Update the profile based on the recent conversation.'
        }]);

        if (!result) {
            return existing;
        }

        let updates;
        try {
            const cleaned = result.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
            updates = JSON.parse(cleaned);
        } catch (parseErr) {
            return existing;
        }

        const allExamples = [...newExamples, ...(existing.examples || [])];
        const uniqueExamples = [];
        const seen = new Set();
        for (const ex of allExamples) {
            const key = (ex.them || '') + (ex.you || '');
            if (!seen.has(key)) {
                seen.add(key);
                uniqueExamples.push(ex);
            }
            if (uniqueExamples.length >= 25) break;
        }

        const existingPatterns = existing.patterns || [];
        const newPatterns = updates.patterns || [];
        const allPatterns = [...new Set([...newPatterns, ...existingPatterns])].slice(0, 15);

        const updatedProfile = {
            ...existing,
            summary: updates.summary || existing.summary,
            style: updates.style || existing.style,
            patterns: allPatterns,
            relationship: updates.relationship || existing.relationship,
            examples: uniqueExamples,
            updated: new Date().toISOString(),
            interactions: (existing.interactions || 0) + (config.learningInterval || 25),
            lastSeen: new Date().toISOString()
        };

        saveProfile(otherUserId, updatedProfile);
        console.log(`profile updated for ${otherUserId}`);

        return updatedProfile;
    } catch (err) {
        return existing;
    }
}

function updateLastSeen(userId) {
    const profile = getProfile(userId);
    if (profile) {
        profile.lastSeen = new Date().toISOString();
        profile.interactions = (profile.interactions || 0) + 1;
        saveProfile(userId, profile);
    }
}

function buildProfileString(profile) {
    if (!profile) return '';

    const parts = [];

    parts.push(profile.summary);

    if (profile.style) {
        const styleDesc = [];
        if (profile.style.formality) styleDesc.push(profile.style.formality);
        if (profile.style.humor && profile.style.humor !== 'none') styleDesc.push(`${profile.style.humor} humor`);
        if (profile.style.emoji && profile.style.emoji !== 'none') styleDesc.push(`${profile.style.emoji} emoji use`);
        if (profile.style.length) styleDesc.push(`${profile.style.length} messages`);
        if (styleDesc.length > 0) {
            parts.push(`Communication style: ${styleDesc.join(', ')}`);
        }
    }

    if (profile.patterns && profile.patterns.length > 0) {
        parts.push(`Common phrases you use: ${profile.patterns.join(', ')}`);
    }

    if (profile.relationship) {
        parts.push(`Relationship: ${profile.relationship}`);
    }

    return parts.join('\n');
}

module.exports = {
    getProfile,
    saveProfile,
    learnProfile,
    updateProfile,
    trackInteraction,
    getInteractionCount,
    updateLastSeen,
    buildProfileString
};