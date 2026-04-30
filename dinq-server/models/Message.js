const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
    senderId: String,
    receiverId: String,

    text: String,

    fileUrl: String,
    fileName: String,

    messageType: {
        type: String,
        default: "text"
    },

    checklistId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Checklist",
        default: null
    },

    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model("Message", messageSchema);