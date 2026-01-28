const fs = require('fs');
const path = require('path');
const config = require('../config.json');
const { chat } = require('./ai');

const memoryDir = path.join(__dirname, '..', 'data', 'memory');
const usersMemoryDir = path.join(memoryDir, 'users');
const selfMemoryPath = path.join(memoryDir, 'self.json');

function ensureMemoryDirs() {
    if (!fs.existsSync(usersMemoryDir)) {
        fs.mkdirSync(usersMemoryDir, { recursive: true });
    }
}

function getUserMemory(userId) {
    const filePath = path.join(usersMemoryDir, `${userId}.json`);

    if (!fs.existsSync(filePath)) {
        return { facts: [], topics: [] };
    }

    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return { facts: [], topics: [] };
    }
}

function saveUserMemory(userId, memory) {
    ensureMemoryDirs();
    const filePath = path.join(usersMemoryDir, `${userId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(memory, null, 2));
}

function getSelfMemory() {
    if (!fs.existsSync(selfMemoryPath)) {
        return { facts: [] };
    }

    try {
        const data = fs.readFileSync(selfMemoryPath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return { facts: [] };
    }
}

function saveSelfMemory(memory) {
    ensureMemoryDirs();
    fs.writeFileSync(selfMemoryPath, JSON.stringify(memory, null, 2));
}

function addUserFact(userId, fact) {
    const memory = getUserMemory(userId);

    const isDupe = memory.facts.some(f =>
        f.fact.toLowerCase().includes(fact.toLowerCase()) ||
        fact.toLowerCase().includes(f.fact.toLowerCase())
    );

    if (!isDupe) {
        memory.facts.push({
            fact: fact,
            when: new Date().toISOString().split('T')[0]
        });
        if (memory.facts.length > 50) {
            memory.facts = memory.facts.slice(-50);
        }
        saveUserMemory(userId, memory);
    }
}

function addUserTopic(userId, topic, note = null) {
    const memory = getUserMemory(userId);

    const existing = memory.topics.find(t =>
        t.topic.toLowerCase() === topic.toLowerCase()
    );

    if (existing) {
        existing.last = new Date().toISOString().split('T')[0];
        if (note) existing.note = note;
    } else {
        memory.topics.push({
            topic: topic,
            last: new Date().toISOString().split('T')[0],
            note: note
        });
    }

    memory.topics.sort((a, b) => new Date(b.last) - new Date(a.last));
    if (memory.topics.length > 30) {
        memory.topics = memory.topics.slice(0, 30);
    }

    saveUserMemory(userId, memory);
}

function addSelfFact(fact) {
    const memory = getSelfMemory();

    const isDupe = memory.facts.some(f =>
        f.fact.toLowerCase().includes(fact.toLowerCase()) ||
        fact.toLowerCase().includes(f.fact.toLowerCase())
    );

    if (!isDupe) {
        memory.facts.push({
            fact: fact,
            when: new Date().toISOString().split('T')[0]
        });
        if (memory.facts.length > 30) {
            memory.facts = memory.facts.slice(-30);
        }
        saveSelfMemory(memory);
    }
}

async function extractMemories(userId, messages) {
    if (!config.memoryExtraction) {
        return null;
    }

    const convo = messages.map(m =>
        `${m.role === 'user' ? 'Them' : 'You'}: ${m.content}`
    ).join('\n');

    const extractionPrompt = `Analyze this conversation and extract any new information worth remembering.

Return ONLY a JSON object with this structure (no other text):
{
  "theirFacts": ["fact about them"],
  "yourFacts": ["fact you revealed about yourself"],
  "topics": [{"topic": "topic name", "note": "brief note"}]
}

Rules:
- Only include concrete, specific facts (names, places, jobs, pets, hobbies, preferences)
- Don't include opinions or temporary states
- Keep facts short (under 10 words each)
- Topics should be things worth remembering for future conversations
- Return empty arrays if nothing notable was shared
- ONLY return the JSON, no explanation`;

    try {
        const result = await chat(extractionPrompt, [{
            role: 'user',
            content: convo
        }]);

        if (!result) return null;

        const cleaned = result.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
        const extracted = JSON.parse(cleaned);

        if (extracted.theirFacts && Array.isArray(extracted.theirFacts)) {
            for (const fact of extracted.theirFacts) {
                if (fact && fact.trim()) {
                    addUserFact(userId, fact.trim());
                }
            }
        }

        if (extracted.yourFacts && Array.isArray(extracted.yourFacts)) {
            for (const fact of extracted.yourFacts) {
                if (fact && fact.trim()) {
                    addSelfFact(fact.trim());
                }
            }
        }

        if (extracted.topics && Array.isArray(extracted.topics)) {
            for (const t of extracted.topics) {
                if (t && t.topic) {
                    addUserTopic(userId, t.topic, t.note || null);
                }
            }
        }

        return extracted;
    } catch (e) {
        return null;
    }
}

function buildMemoryString(userId) {
    const userMemory = getUserMemory(userId);
    const selfMemory = getSelfMemory();
    const parts = [];

    if (userMemory.facts.length > 0) {
        const recentFacts = userMemory.facts.slice(-10).map(f => f.fact);
        parts.push(`Facts about them: ${recentFacts.join(', ')}`);
    }

    if (userMemory.topics.length > 0) {
        const recentTopics = userMemory.topics.slice(0, 5).map(t => {
            return t.note ? `${t.topic} (${t.note})` : t.topic;
        });
        parts.push(`Recent topics: ${recentTopics.join(', ')}`);
    }

    if (selfMemory.facts.length > 0) {
        const selfFacts = selfMemory.facts.slice(-10).map(f => f.fact);
        parts.push(`About you: ${selfFacts.join(', ')}`);
    }

    return parts.join('\n');
}

module.exports = {
    getUserMemory,
    saveUserMemory,
    getSelfMemory,
    saveSelfMemory,
    addUserFact,
    addUserTopic,
    addSelfFact,
    extractMemories,
    buildMemoryString
};