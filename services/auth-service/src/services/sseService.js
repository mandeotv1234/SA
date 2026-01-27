const clients = new Map(); // userId -> Set of response objects (for multiple tabs/devices)

const addClient = (userId, res) => {
    if (!clients.has(userId)) {
        clients.set(userId, new Set());
    }
    clients.get(userId).add(res);
    console.log(`[SSE] Client connected for user ${userId}. Total clients: ${clients.get(userId).size}`);

    // Remove client on close
    res.on('close', () => {
        const userClients = clients.get(userId);
        if (userClients) {
            userClients.delete(res);
            if (userClients.size === 0) {
                clients.delete(userId);
            }
        }
        console.log(`[SSE] Client disconnected for user ${userId}`);
    });
};

const sendEvent = (userId, eventType, data) => {
    const userClients = clients.get(userId);
    if (!userClients || userClients.size === 0) return;

    const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;

    userClients.forEach(client => {
        client.write(message);
    });

    console.log(`[SSE] Sent ${eventType} to ${userClients.size} clients for user ${userId}`);
};

// Keep-alive to prevent timeout
setInterval(() => {
    clients.forEach((userClients) => {
        userClients.forEach(client => {
            client.write(': keep-alive\n\n');
        });
    });
}, 30000);

module.exports = { addClient, sendEvent };
