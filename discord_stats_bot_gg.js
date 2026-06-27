const fs = require('fs');

// Environment variables
const supabaseUrl = process.env.SUPABASE_URL || "https://opnomrruohtwzitokrrf.supabase.co";
const supabaseKey = process.env.SUPABASE_KEY || "sb_publishable_0v5n12WfCXk4bORQEHZPUQ_0D810nRy";
const webhookUrl  = process.env.DISCORD_WEBHOOK_URL;
let   messageId   = process.env.DISCORD_MESSAGE_ID;

if (!webhookUrl) {
    console.error("ERROR: DISCORD_WEBHOOK_URL is not set!");
    process.exit(1);
}

const DEV_TESTED_EXECUTORS = ["Xeno", "Delta", "Volt"];
const DEFAULT_EXECUTORS = [
    "Xeno", "Solara", "Delta", "ByteBreaker v1.5.0",
    "Volt", "Potassium", "Opiumware", "Cosmic", "Arceus X"
];

async function fetchAllTelemetry() {
    let allData = [];
    let offset  = 0;
    const limit = 1000;
    let hasMore = true;

    console.log("Fetching GG telemetry data from Supabase...");
    while (hasMore) {
        const fetchUrl = `${supabaseUrl}/rest/v1/telemetry_gg?select=*&limit=${limit}&offset=${offset}`;
        const response = await fetch(fetchUrl, {
            method: "GET",
            headers: {
                "apikey":        supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`
            }
        });

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const chunk = await response.json();
        allData = allData.concat(chunk);
        console.log(`Downloaded ${chunk.length} records (total: ${allData.length})`);
        hasMore = chunk.length >= limit;
        if (hasMore) offset += limit;
    }
    return allData;
}

function formatPlaytime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    let str = "";
    if (d > 0) str += `${d}d `;
    if (h > 0) str += `${h}h `;
    if (m > 0 || (d === 0 && h === 0)) str += `${m}m`;
    return str.trim();
}

async function run() {
    try {
        const rawData = await fetchAllTelemetry();

        const userRowsMap = {};
        let totalPlaytimeSec = 0;

        rawData.forEach(row => {
            const user = row.username;
            // Skip test accounts
            if (user && user.toLowerCase() === "jgkjgjgh8") return;
            if (!userRowsMap[user]) userRowsMap[user] = [];
            userRowsMap[user].push(row);
        });

        const usersArray = [];

        for (const [username, rows] of Object.entries(userRowsMap)) {
            rows.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

            let userPlaytime  = 0;
            let executions    = 0;
            let lastExecutor  = "Unknown";
            let lastUpdated   = new Date(0);
            const activeMinutes = new Set();

            rows.forEach(row => {
                const playtime = parseInt(row.playtime);
                if (playtime === 0) {
                    executions++;
                } else if (!isNaN(playtime)) {
                    const rowDate   = new Date(row.created_at || 0);
                    const minuteKey = `${rowDate.getFullYear()}-${rowDate.getMonth()+1}-${rowDate.getDate()} ${rowDate.getHours()}:${rowDate.getMinutes()}`;
                    if (!activeMinutes.has(minuteKey)) {
                        activeMinutes.add(minuteKey);
                        userPlaytime     += playtime;
                        totalPlaytimeSec += playtime;
                    }
                }
                const rowDate = new Date(row.created_at || 0);
                if (rowDate > lastUpdated) {
                    lastExecutor = row.executor || "Unknown";
                    lastUpdated  = rowDate;
                }
            });

            if (executions === 0 && userPlaytime > 0) executions = 1;

            usersArray.push({
                username,
                executor:    lastExecutor,
                playtime:    userPlaytime,
                executions,
                avgPlaytime: executions > 0 ? Math.round(userPlaytime / executions) : 0,
                lastUpdated
            });
        }

        const totalUniqueUsers = usersArray.length;

        // Executor distribution
        const execDistribution = {};
        usersArray.forEach(u => {
            execDistribution[u.executor] = (execDistribution[u.executor] || 0) + 1;
        });

        // Leaderboard top 5 by playtime
        usersArray.sort((a, b) => b.playtime - a.playtime);
        let leaderboardText = "";
        usersArray.slice(0, 5).forEach((user, i) => {
            const medal = ["🥇","🥈","🥉","4️⃣","5️⃣"][i];
            leaderboardText += `${medal} **${user.username}** • \`${formatPlaytime(user.playtime)}\` (${user.executions} runs | *${user.executor}*)\n`;
        });
        if (!leaderboardText) leaderboardText = "*No data recorded yet.*";

        // Avg daily executions
        let oldest = new Date(), newest = new Date(0);
        rawData.forEach(row => {
            const d = new Date(row.created_at || 0);
            if (d.getTime() > 0) {
                if (d < oldest) oldest = d;
                if (d > newest) newest = d;
            }
        });
        let daysDiff = Math.ceil((newest - oldest) / (1000 * 3600 * 24));
        if (daysDiff < 1) daysDiff = 1;
        let totalExec = 0;
        usersArray.forEach(u => totalExec += u.executions);
        const avgDailyExecutes = (totalExec / daysDiff).toFixed(1);

        // Executor share
        const executorsSet = new Set(DEFAULT_EXECUTORS);
        usersArray.forEach(u => {
            if (u.executor && u.executor !== "Unknown" && u.executor !== "Unknown Executor")
                executorsSet.add(u.executor);
        });
        let execStatusText = "";
        Array.from(executorsSet).forEach(exec => {
            const count      = execDistribution[exec] || 0;
            const percentage = totalUniqueUsers > 0 ? Math.round((count / totalUniqueUsers) * 100) : 0;
            const emoji      = percentage >= 10 ? "🟢" : "🟠";
            execStatusText  += `${emoji} **${exec}**: \`${percentage}%\`\n`;
        });

        // Build embed
        const embed = {
            title:       "⚡ 6locc Scripts - Grow a Garden 2 Usage",
            description: "*Real-time statistics of active users and executor share.*",
            color:       5832858, // Green #58CF9A
            fields: [
                {
                    name:   "📊 Overview",
                    value:  `👤 **Total Users:** \`${totalUniqueUsers}\`\n⏱️ **Total Playtime:** \`${formatPlaytime(totalPlaytimeSec)}\`\n🚀 **Avg Daily Executes:** \`${avgDailyExecutes}\``,
                    inline: false
                },
                {
                    name:   "🔌 Executor Usage",
                    value:  execStatusText + "\n*Percentage represents the share of unique active users.*",
                    inline: false
                }
            ],
            footer:    { text: "Automatically updated every hour • 6locc Scripts" },
            timestamp: new Date().toISOString()
        };

        const payload = { embeds: [embed] };

        // Send or update Discord message
        let success = false;
        if (messageId) {
            const patchUrl = `${webhookUrl.split('?')[0]}/messages/${messageId}`;
            console.log(`Attempting to update existing message (ID: ${messageId})...`);
            try {
                const patchResponse = await fetch(patchUrl, {
                    method:  "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body:    JSON.stringify(payload)
                });
                if (patchResponse.ok) {
                    console.log("Discord message updated successfully!");
                    success = true;
                } else {
                    console.log(`Update failed (${patchResponse.status}). Creating new message...`);
                }
            } catch (err) {
                console.error("PATCH error, fallback to POST:", err.message);
            }
        }

        if (!success) {
            const postUrl      = `${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}wait=true`;
            console.log("Sending new message to Discord...");
            const postResponse = await fetch(postUrl, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify(payload)
            });
            if (!postResponse.ok) {
                const errText = await postResponse.text();
                throw new Error(`Discord send error: ${postResponse.status} - ${errText}`);
            }
            const responseData = await postResponse.json();
            console.log("\n==================================================");
            console.log("NEW MESSAGE SENT SUCCESSFULLY!");
            console.log(`MESSAGE ID: ${responseData.id}`);
            console.log("Save this ID in your Github Secrets as DISCORD_MESSAGE_ID_GG");
            console.log("so that the bot will update this message going forward.");
            console.log("==================================================\n");
        }

    } catch (err) {
        console.error("Execution error:", err);
        process.exit(1);
    }
}

run();
