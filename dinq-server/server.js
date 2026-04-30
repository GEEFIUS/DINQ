const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const multer = require("multer");

const authRoutes = require("./routes/auth");
const User = require("./models/User");
const Message = require("./models/Message");
const bcrypt = require("bcrypt");
const Checklist = require("./models/Checklist");
const Conversation = require("./models/Conversation");

const app = express();

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

app.use("/", authRoutes);

//
// test route
//
app.get("/", (req, res) => {
    res.send("Backend is running");
});

///
/// Templates
///
const templates = {
    closing: {
        name: "Closing Process",
        items: [
            { title: "Review purchase agreement" },
            { title: "Submit earnest money deposit" },
            { title: "Schedule home inspection" },
            { title: "Review inspection report" },
            { title: "Finalize mortgage documents" },
            { title: "Complete final walkthrough" },
            { title: "Sign closing documents" }
        ]
    },

    listing: {
        name: "Listing Process",
        items: [
            { title: "Gather property documents" },
            { title: "Prepare listing agreement" },
            { title: "Schedule photos" },
            { title: "Publish listing" },
            { title: "Review offers" },
            { title: "Accept offer" }
        ]
    },

    rental: {
        name: "Rental Application",
        items: [
            { title: "Submit application" },
            { title: "Upload proof of income" },
            { title: "Complete background check" },
            { title: "Review lease" },
            { title: "Sign lease" }
        ]
    }
};

//
// users you can message
//
app.get("/users", async (req, res) => {
    try {
        const users = await User.find({}, "_id username");
        console.log("Users returned by /users:", users);
        res.json(users);
    } catch (err) {
        console.error("Users fetch error:", err);
        res.status(500).json({ message: "Failed to load users" });
    }
});

//
// message history between two users
//
app.get("/messages/:a/:b", async (req, res) => {
    try {
        const { a, b } = req.params;

        const messages = await Message.find({
            $or: [
                { senderId: a, receiverId: b },
                { senderId: b, receiverId: a }
            ]
        }).sort({ createdAt: 1 });

        res.json(messages);
    } catch (err) {
        console.error("Message history error:", err);
        res.status(500).json({ message: "Failed to load messages" });
    }
});

//
// saved conversations for sidebar
//
app.get("/conversations/:userId", async (req, res) => {
    try {
        const { userId } = req.params;

        const conversations = await Conversation.find({
            participants: userId
        }).sort({ updatedAt: -1 });

        const formatted = [];

        for (const convo of conversations) {
            const otherUserId = convo.participants.find((id) => id !== userId);
            const otherUser = await User.findById(otherUserId, "_id username");

            if (otherUser) {
                formatted.push({
                    _id: otherUser._id,
                    username: otherUser.username,
                    lastMessage: convo.lastMessage || "No messages yet",
                    lastMessageTime: convo.updatedAt
                });
            }
        }

        res.json(formatted);
    } catch (err) {
        console.error("Conversations error:", err);
        res.status(500).json({ message: "Failed to load conversations" });
    }
});

//
// document vault: all PDFs related to this account
//
app.get("/vault/:userId", async (req, res) => {
    try {
        const { userId } = req.params;

        const files = await Message.find({
            fileUrl: { $exists: true, $ne: "" },
            $or: [
                { senderId: userId },
                { receiverId: userId }
            ]
        }).sort({ createdAt: -1 });

        const userIds = new Set();

        files.forEach((msg) => {
            if (msg.senderId !== userId) userIds.add(msg.senderId);
            if (msg.receiverId !== userId) userIds.add(msg.receiverId);
        });

        const relatedUsers = await User.find(
            { _id: { $in: Array.from(userIds) } },
            "_id username"
        );

        const userMap = {};
        relatedUsers.forEach((u) => {
            userMap[u._id.toString()] = u.username;
        });

        const formatted = files.map((msg) => {
            const otherUserId =
                msg.senderId === userId ? msg.receiverId : msg.senderId;
        
            const safeFileUrl = msg.fileUrl || "";
        
            return {
                _id: msg._id,
                fileUrl: safeFileUrl,
                fileName: msg.fileName || safeFileUrl.split("/").pop() || "Untitled PDF",
                createdAt: msg.createdAt,
                senderId: msg.senderId,
                receiverId: msg.receiverId,
                otherUserId,
                otherUsername: userMap[otherUserId] || "Unknown User"
            };
        });

        res.json(formatted);
    } catch (err) {
        console.error("Vault error:", err);
        res.status(500).json({ message: "Failed to load vault" });
    }
});

//
// file upload
//
const storage = multer.diskStorage({
    destination: "uploads/",
    filename: (req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === "application/pdf") {
            cb(null, true);
        } else {
            cb(new Error("Only PDF files are allowed"));
        }
    }
});

app.post("/upload", upload.single("file"), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }

        res.json({
            fileUrl: `http://localhost:3001/uploads/${req.file.filename}`
        });
    } catch (err) {
        console.error("Upload error:", err);
        res.status(500).json({ message: "File upload failed" });
    }
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});

let onlineUsers = {};

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("register", (userId) => {
        onlineUsers[userId] = socket.id;
        console.log("Registered user:", userId);
    });

    socket.on("send_template", async (data) => {
        try {
            const template = templates[data.templateKey];
    
            if (!template) {
                console.error("Invalid template:", data.templateKey);
                return;
            }
    
            const checklist = await Checklist.create({
                templateName: template.name,
                senderId: data.senderId,
                receiverId: data.receiverId,
                items: template.items
            });
    
            const msg = await Message.create({
                senderId: data.senderId,
                receiverId: data.receiverId,
                text: `Sent template: ${template.name}`,
                messageType: "template",
                checklistId: checklist._id
            });

            await Conversation.findOneAndUpdate(
                {
                    participants: { $all: [data.senderId, data.receiverId] }
                },
                {
                    participants: [data.senderId, data.receiverId],
                    lastMessage: `Sent template: ${template.name}`,
                    updatedAt: new Date()
                },
                {
                    upsert: true,
                    new: true
                }
            );

            await Conversation.findOneAndUpdate(
                {
                    participants: { $all: [data.senderId, data.receiverId] }
                },
                {
                    participants: [data.senderId, data.receiverId],
                    lastMessage: data.text || data.fileName || "Attachment",
                    updatedAt: new Date()
                },
                {
                    upsert: true,
                    new: true
                }
            );
    
            const receiverSocket = onlineUsers[data.receiverId];
    
            if (receiverSocket) {
                io.to(receiverSocket).emit("receive_message", msg);
                io.to(receiverSocket).emit("checklist_received", checklist);
            }
    
            socket.emit("receive_message", msg);
            socket.emit("checklist_received", checklist);
        } catch (err) {
            console.error("Template send error:", err);
        }
    });

    socket.on("private_message", async (data) => {
        try {
            console.log("private_message received:", data);

            if (!data.senderId || !data.receiverId) {
                return;
            }

            if ((!data.text || !data.text.trim()) && !data.fileUrl) {
                return;
            }

            const msg = await Message.create({
                senderId: data.senderId,
                receiverId: data.receiverId,
                text: data.text || "",
                fileUrl: data.fileUrl || "",
                fileName: data.fileName || "",
                messageType: data.fileUrl ? "file" : "text"
            });

            const receiverSocket = onlineUsers[data.receiverId];

            if (receiverSocket) {
                io.to(receiverSocket).emit("receive_message", msg);
            }

            socket.emit("receive_message", msg);
        } catch (err) {
            console.error("Socket message error:", err);
        }
    });

    socket.on("disconnect", () => {
        for (const userId in onlineUsers) {
            if (onlineUsers[userId] === socket.id) {
                delete onlineUsers[userId];
                break;
            }
        }

        console.log("User disconnected:", socket.id);
    });
});

//example connection: mongodb+srv://username_db_user:Password123@cluster0.t4p4dwe.mongodb.net/dinq?retryWrites=true&w=majority&appName=Cluster0
mongoose.connect("    insert mongodb connectinon     ")
    .then(() => {
        console.log("Mongo Connected");
    })
    .catch((err) => {
        console.error("Mongo connection error:", err);
    });



//
// get a user's profile
//
app.get("/profile/:userId", async (req, res) => {
    try {
        console.log("PROFILE ROUTE HIT:", req.params.userId);

        const user = await User.findById(
            req.params.userId,
            "_id username email profilePicture"
        );

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        res.json(user);
    } catch (err) {
        console.error("Profile fetch error:", err);
        res.status(500).json({ message: "Failed to load profile" });
    }
});

//
// update profile info
//
app.put("/profile/:userId", async (req, res) => {
    try {
        const { email, password, profilePicture } = req.body;

        const updateData = {};

        if (typeof email === "string") {
            updateData.email = email;
        }

        if (typeof profilePicture === "string") {
            updateData.profilePicture = profilePicture;
        }

        if (password && password.trim()) {
            updateData.password = await bcrypt.hash(password, 10);
        }

        const updatedUser = await User.findByIdAndUpdate(
            req.params.userId,
            updateData,
            { new: true, fields: "_id username email profilePicture" }
        );

        if (!updatedUser) {
            return res.status(404).json({ message: "User not found" });
        }

        res.json(updatedUser);
    } catch (err) {
        console.error("Profile update error:", err);
        res.status(500).json({ message: "Failed to update profile" });
    }
});

const profileStorage = multer.diskStorage({
    destination: "uploads/",
    filename: (req, file, cb) => {
        cb(null, "profile-" + Date.now() + "-" + file.originalname);
    }
});

const profileUpload = multer({
    storage: profileStorage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        } else {
            cb(new Error("Only image files are allowed"));
        }
    }
});

app.post("/upload-profile-picture", profileUpload.single("file"), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }

        res.json({
            fileUrl: `http://localhost:3001/uploads/${req.file.filename}`
        });
    } catch (err) {
        console.error("Profile picture upload error:", err);
        res.status(500).json({ message: "Profile picture upload failed" });
    }
});

///
/// Checklist/Timeline
///

app.get("/templates", (req, res) => {
    res.json(templates);
});

app.get("/timeline/:userId", async (req, res) => {
    try {
        const { userId } = req.params;

        const checklists = await Checklist.find({
            $or: [
                { senderId: userId },
                { receiverId: userId }
            ]
        }).sort({ createdAt: -1 });

        res.json(checklists);
    } catch (err) {
        console.error("Timeline error:", err);
        res.status(500).json({ message: "Failed to load timeline" });
    }
});

app.put("/timeline/:checklistId/item/:itemId", async (req, res) => {
    try {
        const { checklistId, itemId } = req.params;
        const { completed } = req.body;

        const checklist = await Checklist.findById(checklistId);

        if (!checklist) {
            return res.status(404).json({ message: "Checklist not found" });
        }

        const item = checklist.items.id(itemId);

        if (!item) {
            return res.status(404).json({ message: "Checklist item not found" });
        }

        item.completed = completed;
        await checklist.save();

        const senderSocket = onlineUsers[checklist.senderId];
        const receiverSocket = onlineUsers[checklist.receiverId];

        if (senderSocket) {
            io.to(senderSocket).emit("checklist_updated", checklist);
        }

        if (receiverSocket) {
            io.to(receiverSocket).emit("checklist_updated", checklist);
        }

        res.json(checklist);
    } catch (err) {
        console.error("Checklist update error:", err);
        res.status(500).json({ message: "Failed to update checklist item" });
    }
});

//
// latest message for homepage
//
app.get("/home/latest-message/:userId", async (req, res) => {
    try {
        const { userId } = req.params;

        const latestMessage = await Message.findOne({
            $or: [
                { senderId: userId },
                { receiverId: userId }
            ]
        }).sort({ createdAt: -1 });

        if (!latestMessage) {
            return res.json(null);
        }

        const otherUserId =
            latestMessage.senderId === userId
                ? latestMessage.receiverId
                : latestMessage.senderId;

        const otherUser = await User.findById(otherUserId, "_id username");

        res.json({
            _id: latestMessage._id,
            text: latestMessage.text,
            fileUrl: latestMessage.fileUrl,
            fileName: latestMessage.fileName,
            messageType: latestMessage.messageType,
            createdAt: latestMessage.createdAt,
            otherUsername: otherUser ? otherUser.username : "Unknown User",
            wasSentByMe: latestMessage.senderId === userId
        });
    } catch (err) {
        console.error("Latest message error:", err);
        res.status(500).json({ message: "Failed to load latest message" });
    }
});

//
// most recent checklist for homepage
//
app.get("/home/latest-checklist/:userId", async (req, res) => {
    try {
        const { userId } = req.params;

        const checklist = await Checklist.findOne({
            $or: [
                { senderId: userId },
                { receiverId: userId }
            ]
        }).sort({ createdAt: -1 });

        if (!checklist) {
            return res.json(null);
        }

        const completed = checklist.items.filter((item) => item.completed).length;
        const total = checklist.items.length;
        const progress = total === 0 ? 0 : Math.round((completed / total) * 100);

        res.json({
            _id: checklist._id,
            templateName: checklist.templateName,
            createdAt: checklist.createdAt,
            completed,
            total,
            progress
        });
    } catch (err) {
        console.error("Latest checklist error:", err);
        res.status(500).json({ message: "Failed to load latest checklist" });
    }
});

app.post("/conversations/start", async (req, res) => {
    try {
        const { userId, otherUserId } = req.body;

        let conversation = await Conversation.findOne({
            participants: { $all: [userId, otherUserId] }
        });

        if (!conversation) {
            conversation = await Conversation.create({
                participants: [userId, otherUserId],
                lastMessage: "",
                updatedAt: new Date()
            });
        }

        res.json(conversation);
    } catch (err) {
        console.error("Start conversation error:", err);
        res.status(500).json({ message: "Failed to start conversation" });
    }
});

server.listen(3001, () => {
    console.log("Server running on port 3001");
});

