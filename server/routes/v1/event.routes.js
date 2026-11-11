const express = require("express");
const { authenticate } = require("../../middleware/authenticate");
const {
  createEvent,
  listEvents,
  updateEvent,
  deleteEvent,
} = require("../../controllers/event.controller");

const router = express.Router();

router.use(authenticate);

router.get("/", listEvents);
router.post("/", createEvent);
router.patch("/:eventId", updateEvent);
router.put("/:eventId", updateEvent);
router.delete("/:eventId", deleteEvent);

module.exports = router;
