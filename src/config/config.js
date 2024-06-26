const dotenv = require('dotenv')
const path = require('path')

dotenv.config({ path: path.join(__dirname, '../../.env')})

module.exports = {
    port: process.env.PORT,
    database: {
        url: process.env.DATABASE_URL
    },
    jwt: {
        secret: process.env.JWT_SECRET
    },
    gemini: {
        apiKey: process.env.API_KEY
    }

}