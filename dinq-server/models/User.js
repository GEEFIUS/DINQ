const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    email: { type: String, default: "" },
    password: { type: String, required: true },
    profilePicture: { type: String, default: "" }
});

module.exports = mongoose.model("User", userSchema);