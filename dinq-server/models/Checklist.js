const mongoose = require("mongoose");

const checklistItemSchema = new mongoose.Schema({
    title: String,
    completed: { type: Boolean, default: false },
    fileUrl: { type: String, default: "" },
    fileName: { type: String, default: "" }
});

const checklistSchema = new mongoose.Schema({
    templateName: String,

    senderId: String,
    receiverId: String,

    items: [checklistItemSchema],

    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model("Checklist", checklistSchema);