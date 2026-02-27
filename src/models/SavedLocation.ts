import mongoose, { Schema, model, models } from "mongoose";

const savedLocationSchema = new Schema(
  {
    address: { type: String, required: true },
    label: { type: String },
  },
  { timestamps: true }
);

export const SavedLocationModel =
  models.SavedLocation ?? model("SavedLocation", savedLocationSchema);
