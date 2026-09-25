const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
    try {
        if (!process.env.MONGO_URI) {
            throw new Error('MONGO_URI no está definida en backend/.env');
        }

        await mongoose.connect(process.env.MONGO_URI);
        console.log('Conexión a MongoDB exitosa :)');
    } catch (error) {
        console.error('Error al conectar a MongoDB:', error);
        throw error;
    }
};

module.exports = connectDB;