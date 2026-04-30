const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema({
    participants: [String],
    lastMessage: { type: String, default: "" },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Conversation", conversationSchema);