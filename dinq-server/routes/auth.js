const router = require("express").Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const SECRET = "secretkey";

router.post("/register", async (req, res) => {
    try {
        const { username, password, email } = req.body;

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: "Username already exists" });
        }

        const hashed = await bcrypt.hash(password, 10);

        const user = await User.create({
            username,
            email: email || "",
            password: hashed
        });

        res.json({
            message: "User registered successfully",
            userId: user._id,
            username: user.username
        });
    } catch (err) {
        console.error("REGISTER ERROR:", err);
        res.status(500).json({ message: "Registration failed" });
    }
});

router.post("/login", async (req, res) => {
    try {
        const user = await User.findOne({ username: req.body.username });

        if (!user) {
            return res.status(400).json({ message: "User not found" });
        }

        const valid = await bcrypt.compare(req.body.password, user.password);

        if (!valid) {
            return res.status(400).json({ message: "Wrong password" });
        }

        const token = jwt.sign({ id: user._id }, SECRET);

        res.json({ token, userId: user._id });
    } catch (err) {
        console.error("LOGIN ERROR:", err);
        res.status(500).json({ message: "Login failed" });
    }
});

module.exports = router;