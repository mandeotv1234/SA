require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sepayRoutes = require('./routes/sepay');
const paymentRoutes = require('./routes/payment');
const { connectProducer, createTopics } = require('./config/kafka');
const { initDB } = require('./db/connection');
const PaymentTransaction = require('./models/PaymentTransaction');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

app.use('/sepay', sepayRoutes);
app.use('/payment', paymentRoutes);

app.get('/health', (req, res) => {
    res.send('Payment Service is running');
});

// Expire old transactions every 5 minutes
setInterval(async () => {
    try {
        const expired = await PaymentTransaction.expireOldTransactions();
        if (expired > 0) {
            console.log(`Expired ${expired} old transactions`);
        }
    } catch (error) {
        console.error('Error expiring transactions:', error);
    }
}, 5 * 60 * 1000);

const startServer = async () => {
    try {
        await initDB();
        console.log('Database initialized');
        await connectProducer();
        await createTopics();
        app.listen(PORT, () => {
            console.log(`Payment Service running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();
