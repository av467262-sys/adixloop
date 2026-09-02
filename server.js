const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();

const app = express();

/* =========================
   CONFIG
========================= */

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "25mb" }));

/* =========================
   HELPERS
========================= */

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function toObjectId(id) {
  return new mongoose.Types.ObjectId(id);
}

function cleanUserId(id) {
  return String(id || "").trim();
}

/* =========================
   DATABASE
========================= */

let db;

async function connectDatabase() {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is missing");
  }

  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 10000
  });

  db = mongoose.connection.db;

  console.log("MongoDB connected successfully");
}

/* =========================
   HEALTH
========================= */

app.get("/", (req, res) => {
  res.json({
    success: true,
    app: "Adixloop",
    status: "online",
    message: "Adixloop Backend is running 🚀"
  });
});

app.get("/api/health", async (req, res) => {
  res.json({
    success: true,
    status: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    database: "MongoDB Atlas"
  });
});

/* =========================
   POSTS
========================= */

// Get posts
app.get("/api/posts", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    const posts = await db
      .collection("Posts")
      .find({})
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({
      success: true,
      count: posts.length,
      posts
    });

  } catch (error) {
    console.error("GET POSTS:", error);

    res.status(500).json({
      success: false,
      message: "Unable to load posts"
    });
  }
});

// Get single post
app.get("/api/posts/:id", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid post ID"
      });
    }

    const post = await db.collection("Posts").findOne({
      _id: toObjectId(req.params.id)
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found"
      });
    }

    res.json({
      success: true,
      post
    });

  } catch (error) {
    console.error("GET POST:", error);

    res.status(500).json({
      success: false,
      message: "Unable to load post"
    });
  }
});

// Create post
app.post("/api/posts", async (req, res) => {
  try {
    const {
      userId,
      username,
      caption = "",
      mediaUrl = "",
      mediaType = "image",
      thumbnail = ""
    } = req.body;

    if (!mediaUrl) {
      return res.status(400).json({
        success: false,
        message: "mediaUrl is required"
      });
    }

    const post = {
      userId: cleanUserId(userId) || "guest",
      username: username || "Adixloop User",
      caption,
      mediaUrl,
      mediaType,
      thumbnail,
      likesCount: 0,
      commentsCount: 0,
      savesCount: 0,
      sharesCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection("Posts").insertOne(post);

    post._id = result.insertedId;

    res.status(201).json({
      success: true,
      message: "Post created successfully",
      post
    });

  } catch (error) {
    console.error("CREATE POST:", error);

    res.status(500).json({
      success: false,
      message: "Unable to create post"
    });
  }
});

/* =========================
   LIKE
========================= */

app.post("/api/posts/:id/like", async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = cleanUserId(req.body.userId);

    if (!isValidId(postId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid post ID"
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required"
      });
    }

    const postObjectId = toObjectId(postId);

    const existingLike = await db.collection("likes").findOne({
      postId: postObjectId,
      userId
    });

    let liked;

    if (existingLike) {
      await db.collection("likes").deleteOne({
        _id: existingLike._id
      });

      await db.collection("Posts").updateOne(
        { _id: postObjectId },
        { $inc: { likesCount: -1 }, $set: { updatedAt: new Date() } }
      );

      liked = false;

    } else {
      await db.collection("likes").insertOne({
        postId: postObjectId,
        userId,
        createdAt: new Date()
      });

      await db.collection("Posts").updateOne(
        { _id: postObjectId },
        { $inc: { likesCount: 1 }, $set: { updatedAt: new Date() } }
      );

      liked = true;
    }

    const totalLikes = await db.collection("likes").countDocuments({
      postId: postObjectId
    });

    res.json({
      success: true,
      liked,
      likesCount: totalLikes
    });

  } catch (error) {
    console.error("LIKE:", error);

    res.status(500).json({
      success: false,
      message: "Unable to update like"
    });
  }
});

/* =========================
   COMMENTS
========================= */

app.get("/api/posts/:id/comments", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid post ID"
      });
    }

    const comments = await db
      .collection("comments")
      .find({
        postId: toObjectId(req.params.id)
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      success: true,
      count: comments.length,
      comments
    });

  } catch (error) {
    console.error("GET COMMENTS:", error);

    res.status(500).json({
      success: false,
      message: "Unable to load comments"
    });
  }
});

app.post("/api/posts/:id/comment", async (req, res) => {
  try {
    const postId = req.params.id;

    const {
      userId,
      username,
      text
    } = req.body;

    if (!isValidId(postId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid post ID"
      });
    }

    if (!text || !String(text).trim()) {
      return res.status(400).json({
        success: false,
        message: "Comment cannot be empty"
      });
    }

    const comment = {
      postId: toObjectId(postId),
      userId: cleanUserId(userId) || "guest",
      username: username || "Adixloop User",
      text: String(text).trim(),
      createdAt: new Date()
    };

    const result = await db.collection("comments").insertOne(comment);

    comment._id = result.insertedId;

    await db.collection("Posts").updateOne(
      { _id: toObjectId(postId) },
      {
        $inc: { commentsCount: 1 },
        $set: { updatedAt: new Date() }
      }
    );

    res.status(201).json({
      success: true,
      message: "Comment added",
      comment
    });

  } catch (error) {
    console.error("COMMENT:", error);

    res.status(500).json({
      success: false,
      message: "Unable to add comment"
    });
  }
});

/* =========================
   SAVE
========================= */

app.post("/api/posts/:id/save", async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = cleanUserId(req.body.userId);

    if (!isValidId(postId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid post ID"
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required"
      });
    }

    const postObjectId = toObjectId(postId);

    const existingSave = await db.collection("saves").findOne({
      postId: postObjectId,
      userId
    });

    let saved;

    if (existingSave) {
      await db.collection("saves").deleteOne({
        _id: existingSave._id
      });

      await db.collection("Posts").updateOne(
        { _id: postObjectId },
        { $inc: { savesCount: -1 } }
      );

      saved = false;

    } else {
      await db.collection("saves").insertOne({
        postId: postObjectId,
        userId,
        createdAt: new Date()
      });

      await db.collection("Posts").updateOne(
        { _id: postObjectId },
        { $inc: { savesCount: 1 } }
      );

      saved = true;
    }

    res.json({
      success: true,
      saved
    });

  } catch (error) {
    console.error("SAVE:", error);

    res.status(500).json({
      success: false,
      message: "Unable to update save"
    });
  }
});

/* =========================
   FOLLOW
========================= */

app.post("/api/users/:id/follow", async (req, res) => {
  try {
    const targetUserId = cleanUserId(req.params.id);
    const followerId = cleanUserId(req.body.userId);

    if (!targetUserId || !followerId) {
      return res.status(400).json({
        success: false,
        message: "Both user IDs are required"
      });
    }

    if (targetUserId === followerId) {
      return res.status(400).json({
        success: false,
        message: "You cannot follow yourself"
      });
    }

    const existingFollow = await db.collection("follows").findOne({
      followerId,
      followingId: targetUserId
    });

    let following;

    if (existingFollow) {
      await db.collection("follows").deleteOne({
        _id: existingFollow._id
      });

      following = false;

    } else {
      await db.collection("follows").insertOne({
        followerId,
        followingId: targetUserId,
        createdAt: new Date()
      });

      following = true;
    }

    res.json({
      success: true,
      following
    });

  } catch (error) {
    console.error("FOLLOW:", error);

    res.status(500).json({
      success: false,
      message: "Unable to update follow"
    });
  }
});

/* =========================
   NOTIFICATIONS
========================= */

app.get("/api/notifications", async (req, res) => {
  try {
    const userId = cleanUserId(req.query.userId);

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required"
      });
    }

    const notifications = await db
      .collection("notifications")
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    res.json({
      success: true,
      notifications
    });

  } catch (error) {
    console.error("NOTIFICATIONS:", error);

    res.status(500).json({
      success: false,
      message: "Unable to load notifications"
    });
  }
});

/* =========================
   REPORTS
========================= */

app.post("/api/reports", async (req, res) => {
  try {
    const {
      userId,
      postId,
      reason,
      details = ""
    } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: "Report reason is required"
      });
    }

    const report = {
      userId: cleanUserId(userId) || "guest",
      postId: isValidId(postId) ? toObjectId(postId) : null,
      reason,
      details,
      status: "pending",
      createdAt: new Date()
    };

    const result = await db.collection("reports").insertOne(report);

    res.status(201).json({
      success: true,
      message: "Report submitted",
      reportId: result.insertedId
    });

  } catch (error) {
    console.error("REPORT:", error);

    res.status(500).json({
      success: false,
      message: "Unable to submit report"
    });
  }
});

/* =========================
   SCORES
========================= */

app.get("/api/scores", async (req, res) => {
  try {
    const scores = await db
      .collection("scores")
      .find({})
      .sort({ score: -1 })
      .limit(100)
      .toArray();

    res.json({
      success: true,
      scores
    });

  } catch (error) {
    console.error("SCORES:", error);

    res.status(500).json({
      success: false,
      message: "Unable to load scores"
    });
  }
});

/* =========================
   404
========================= */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found",
    path: req.originalUrl
  });
});

/* =========================
   ERROR HANDLER
========================= */

app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);

  res.status(500).json({
    success: false,
    message: "Internal server error"
  });
});

/* =========================
   START SERVER
========================= */

async function startServer() {
  try {
    await connectDatabase();

    app.listen(PORT, () => {
      console.log(`Adixloop backend running on port ${PORT}`);
    });

  } catch (error) {
    console.error("Database connection failed:", error.message);
    process.exit(1);
  }
}

startServer();
