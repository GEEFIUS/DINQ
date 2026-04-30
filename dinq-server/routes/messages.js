app.get("/messages/:a/:b", async (req, res) => {
    const { a, b } = req.params;

    const messages = await Message.find({
        $or: [
            { senderId: a, receiverId: b },
            { senderId: b, receiverId: a }
        ]
    }).sort({ createdAt: 1 });

    res.json(messages);
});