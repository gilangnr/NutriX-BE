const httpStatus = require("http-status")
const profileService = require('../services/profile-service')
const { calculateAge, parseDateString } = require('../utils/dateUtils')
const { calculateCalories, calculateTotalNutrition, calculateDailyNutrition } = require('../utils/calorieCalculator')
const prisma = require("../../prisma")
const ApiError = require("../utils/apiError")
const { GoogleGenerativeAI } = require('@google/generative-ai')
const config = require('../config/config')
const apiKey = config.gemini.apiKey
const genAI = new GoogleGenerativeAI(apiKey)

const calorieTracker = async (userId, body) => {
    try {
        const nutrition = await prisma.nutrition.findFirst({
            where: { userId: userId }
        }) 
        const update = parseDateString(nutrition.updatedAt)
        const today = parseDateString(new Date())
    
        if(update !== today){
            const userProfile = await prisma.userProfile.findFirst({
                where: { userId: userId}
            })
    
            const { dateOfBirth, gender, weight, height } = userProfile
            const age = calculateAge(dateOfBirth)
            const calories = calculateCalories(gender, weight, height, age)
    
            await prisma.nutrition.update({
                where: {
                    userId: userId
                },
                data: {
                    dailyCalorie: calories,
                    dailyCarbohydrate: 0.15 * calories,
                    dailySugar: 50,
                    dailyFat: 0.2 * calories,
                    dailyProtein: weight * 0.8
                }
            })
        }

        const { base64Image } = body
        const inlineData = {
            data: base64Image,
            mimeType: 'image/jpeg'
        }
        
        const dataToSend = {
            inlineData
        }

        const prompt = `Berdasarkan analisis gambar, analisis nilai dibawah ini dengan nilai tetap (tanpa menggunakan rentang) dan tanpa menggunakan satuan (misalnya gram, kkal, dll). Jika ada yang tidak punya nilai isi dengan 0, kirim response dalam format json dibawah ini
        {
            "foodName": "{food_name}",
            "calorie": "{calorie_count_kkal}",
            "sugar": " "{sugar_content_grams}",
            "carbohydrate": "{carbohydrate_content_grams}"
            "fat": "{fat_content_grams}"
            "protein": "{protein_content_grams}"
        }
        ` 
        const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" })
            const result = await model.generateContent([prompt, dataToSend])
            const response = await result.response
            const responseJson = await response.text()

            if(responseJson){
                const { foodName, calorie, sugar, carbohydrate, fat, protein } = JSON.parse(responseJson)
                const foodInfo = {
                    foodName,
                    calorie,
                    sugar,
                    carbohydrate,
                    fat,
                    protein
                }
            
                await prisma.history.create({
                    data: {
                        userId: userId,
                        foodName: foodName,
                        totalCalorie: calorie,
                        totalCarbohydrate: carbohydrate,
                        totalFat: fat,
                        totalProtein: protein,
                        totalSugar: sugar
                    }
                })

                const recentNutrition = await prisma.nutrition.findFirst({
                    where: {
                        userId: userId
                    }
                })

                const { dailyCalorie, dailyCarbohydrate, dailyFat, dailyProtein, dailySugar } = recentNutrition
                const updateNutrition = await prisma.nutrition.update({
                    where: {
                        userId: userId
                    },
                    data: {
                        dailyCalorie: dailyCalorie - calorie,
                        dailyCarbohydrate: dailyCarbohydrate - carbohydrate,
                        dailyFat: dailyFat - fat,
                        dailyProtein: dailyProtein - protein,
                        dailySugar: dailySugar - sugar
                    }
                })

                const userProfile = await prisma.userProfile.findFirst({
                    where: { userId: userId }
                })

                const resultData = {
                    foodInfo: foodInfo,
                    totalNutrition: calculateTotalNutrition(userProfile, updateNutrition),
                }
                
                return resultData
            }
        } catch (error) {
            console.log(error)
            throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Error processing your image, Please try again')
        }
 
}

const imageTracker = async (body) => {
    const data = {
        inlineData: body.image
    };
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })
    const prompt = "What's picture is this?"

    const result = await model.generateContent([prompt, data])
    const response = await result.response
    const text = response.text()

    return text
}

const getAllHistory = async () => {
    return await prisma.history.findMany()
}

const getHistoryByUserId = async (userId) => {
    return await prisma.history.findMany({
        where: { userId: userId }
    })
}

const getDailyNutrition = async (userId) => {

    const nutrition = await prisma.nutrition.findFirst({
        where: { userId: userId }
    }) 

    const update = parseDateString(nutrition.updatedAt)
    const today = parseDateString(new Date())
    
    if(update !== today){
        const userProfile = await prisma.userProfile.findFirst({
            where: { userId: userId}
        })
    
        const { dateOfBirth, gender, weight, height } = userProfile
        const age = calculateAge(dateOfBirth)
        const calories = calculateCalories(gender, weight, height, age)
    
        const nutrition = await prisma.nutrition.update({
            where: {
                userId: userId
            },
            data: {
                dailyCalorie: calories,
                dailyCarbohydrate: 0.15 * calories,
                dailySugar: 50,
                dailyFat: 0.2 * calories,
                dailyProtein: weight * 0.8
            }
        })

        return nutrition
    }

    return nutrition

}

const getProgressNutrition = async (userId) => {
    const user = await prisma.userProfile.findFirst({
        where: { userId: userId }
    })

    const nutrition = await prisma.nutrition.findFirst({
        where: {
            userId: userId
        }
    })

    const update = parseDateString(nutrition.updatedAt)
    const today = parseDateString(new Date())

    if(update !== today){
        
        const newNutrition = calculateDailyNutrition(user)

        const updatedNutrition = await prisma.nutrition.update({
            where: {
                userId: userId
            },
            data: {
                dailyCalorie: newNutrition.calories,
                dailyCarbohydrate: newNutrition.carbohydrate,
                dailySugar: newNutrition.sugar,
                dailyFat: newNutrition.fat,
                dailyProtein: newNutrition.proteins
            }
        })
        return calculateTotalNutrition(user, updatedNutrition)
    }

    return calculateTotalNutrition(user, nutrition)

}

const deleteAllHistory = async (userId) => {
    const result = await prisma.history.deleteMany({
        where: {
            userId: userId
        }
    })

    return result
}

const foodRecommendation = async (userId) => {
    const user = await prisma.userProfile.findFirst({
        where: {
            userId: userId
        }
    })

    if(!user){
        throw new ApiError(httpStatus.BAD_REQUEST, 'User not found')
    }

    const nutritionLeft = await getDailyNutrition(userId)

    let { allergies } = user

    if(allergies !== null) {
        allergies = 'tidak punya'
    }

    const { dailyCalorie, dailyCarbohydrate, dailyFat, dailyProtein, dailySugar } = nutritionLeft

    const prompt = ` saya memiliki alergi ${allergies}, rekomendasikan saya 3 makanan jika berikut adalah sisa kebutuhan harian saya 
    kalori: ${dailyCalorie},
    karbohidrat: ${dailyCarbohydrate},
    lemak: ${dailyFat},
    protein: ${dailyProtein},
    batas gula harian : ${dailySugar},
    kirim response dalam format json dibawah ini
    {
    "food1": {
        "foodName": "{makanan}",
        "information": "{keterangan}"
    },
    "food2": {
        "foodName": "{makanan}",
        "information": "{keterangan}"
    },
    "food3": {
        "foodName": "{makanan}",
        "information": "{keterangan}"
    }
}
    `

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: "gemini-pro"})

    const result = await model.generateContent(prompt)
    const response = await result.response
    const text = response.text()
    const stringResponse = JSON.parse(text)
    return stringResponse
}

module.exports = {
    calorieTracker,
    imageTracker,
    getAllHistory,
    getHistoryByUserId,
    getProgressNutrition,
    getDailyNutrition,
    deleteAllHistory,
    foodRecommendation
}