const express = require("express");
const mongoose = require("mongoose");
const AWS = require("aws-sdk");
const cors = require("cors");
require("dotenv").config();

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// AWS Configuration
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID_S3,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_S3,
  region: process.env.AWS_REGION,
});

// MongoDB Configuration
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Define Mongoose Models
const UserSchema = new mongoose.Schema({
  name: String,
  imageKey: String,
});
const User = mongoose.model("User", UserSchema);

const AttendanceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  timestamp: { type: Date, default: Date.now },
  imageKey: String,
});
const Attendance = mongoose.model("Attendance", AttendanceSchema);

// Route to add a new user
app.post("/admin/register", async (req, res) => {
  console.log("Adding new user", req.body);
  const { name, imageKey } = req.body;

  const user = new User({
    name,
    imageKey,
  });

  await user.save();
  res.status(201).json(user);
  console.log("User added", user);
});
// Route to get a pre-signed URL for uploading an image
app.get("/generate-presigned-url", (req, res) => {
  console.log("Generating pre-signed URL", req.query);
  const { fileName, fileType } = req.query;

  const s3Params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: `${Date.now()}_${fileName}`,
    Expires: 120, // URL expiration time in seconds
    ContentType: fileType,
    ACL: "public-read",
  };
  console.log("s3Params", s3Params);
  s3.getSignedUrl("putObject", s3Params, (err, url) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ url, key: s3Params.Key });
    console.log("Pre-signed URL generated", url);
  });
});

// Route to handle image comparison and attendance marking
app.post("/user/compare", async (req, res) => {
  console.log("Comparing images", req.body);
  const { name, imageKey } = req.body;

  try {
    const user = await User.findOne({ name: name });
    console.log("User found", user);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Compare images using AWS Rekognition
    const rekognition = new AWS.Rekognition({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID_REKOG,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_REKOG,
    });

    const s3Params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Name: imageKey,
    };

    const comparisonParams = {
      SourceImage: {
        S3Object: {
          Bucket: process.env.S3_BUCKET_NAME,
          Name: user.imageKey,
        },
      },
      TargetImage: {
        S3Object: s3Params,
      },
      SimilarityThreshold: 90, // Adjust as needed
    };

    rekognition.compareFaces(comparisonParams, async (err, data) => {
      if (err) {
        console.log(err);
        return res.status(500).json({ error: err.message });
      }
      console.log("data", data);
      // Mark attendance if images match
      if (data.FaceMatches.length > 0) {
        const attendance = new Attendance({
          userId: user._id,
          imageKey: s3Params.Name,
        });
        console.log("Attendance marked", attendance);
        await attendance.save();
        res.status(200).json({ message: "Attendance marked" });
      } else {
        console.log("Face not recognized");
        res.status(400).json({ message: "Face not recognized" });
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
    console.log(error);
  }
});

// Route to view attendance history
app.get("/admin/history", async (req, res) => {
  try {
    const attendance = await Attendance.find().populate("userId");
    res.status(200).json(attendance);
    console.log("Attendance history retrieved", attendance);
  } catch (error) {
    res.status(500).json({ error: error.message });
    console.log(error);
  }
});

// Route to view all users
app.get("/admin/users", async (req, res) => {
  try {
    const users = await User.find();
    res.status(200).json(users);
    console.log("Users retrieved", users);
  } catch (error) {
    res.status(500).json({ error: error.message });
    console.log(error);
  }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
