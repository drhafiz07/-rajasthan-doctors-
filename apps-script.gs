// ============================================================
//  Rajasthan Doctor Directory — Google Apps Script (Full)
//  Handles: add, edit, delete, register, approve, reject
//  Deploy as Web App → Execute as: Me → Access: Anyone
// ============================================================

const SHEET_ID    = "17qxpKmS93HTabcafybGZdez9nrSN228_cuMOUfxNOBc";
const ADMIN_EMAIL = "your-admin-email@gmail.com";  // ← change this

// ------------------------------------------------------------
//  SETUP — run this ONCE manually to create the Pending tab
//  Click Run → setupSheets in the Apps Script editor
// ------------------------------------------------------------
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log("Opened: " + ss.getName());

  let pending = ss.getSheetByName("Pending");
  if (!pending) {
    pending = ss.insertSheet("Pending");
    pending.appendRow([
      "Name", "Specialization", "City", "Hospital", "Qualification",
      "Contact", "Email", "Gender", "College", "Experience",
      "Registration No", "Fees", "District", "Address", "Timing",
      "Languages", "Status", "Submitted At"
    ]);
    pending.getRange(1, 1, 1, 18)
      .setFontWeight("bold")
      .setBackground("#5E0819")
      .setFontColor("#FFFFFF");
    pending.setFrozenRows(1);
    Logger.log("Pending sheet created successfully.");
    SpreadsheetApp.getUi().alert("Done! Pending tab has been created in your Google Sheet.");
  } else {
    Logger.log("Pending sheet already exists.");
    SpreadsheetApp.getUi().alert("Pending tab already exists in your sheet.");
  }
}

// ------------------------------------------------------------
//  POST HANDLER — receives all actions from frontend
// ------------------------------------------------------------
function doPost(e) {
  try {
    // Handle both application/json and text/plain (no-cors sends text/plain)
    const raw     = e.postData ? e.postData.contents : "{}";
    const payload = JSON.parse(raw);
    const ss      = SpreadsheetApp.openById(SHEET_ID);

    // ── DOCTOR SELF-REGISTRATION ──
    if (payload.action === "register") {
      const pending = ss.getSheetByName("Pending");
      if (!pending) throw new Error("Pending sheet not found. Please run setupSheets() first.");
      pending.appendRow(payload.data);

      // Notify admin by email
      notifyAdmin(payload.data);

      return respond({ status: "ok", message: "Registration submitted for review." });
    }

    // ── APPROVE DOCTOR (admin action) ──
    if (payload.action === "approve") {
      const pending  = ss.getSheetByName("Pending");
      const approved = ss.getSheetByName(payload.approvedSheet || "Sheet1");
      if (!pending)  throw new Error("Pending sheet not found.");
      if (!approved) throw new Error("Approved sheet not found.");

      const row      = parseInt(payload.rowIndex);
      const rowData  = pending.getRange(row, 1, 1, pending.getLastColumn()).getValues()[0];
      const headers  = pending.getRange(1, 1, 1, pending.getLastColumn()).getValues()[0];

      // Get approved sheet headers to map columns correctly
      const approvedHeaders = approved.getRange(1, 1, 1, approved.getLastColumn()).getValues()[0];

      // Build row matching approved sheet column order
      // Columns: Name, Specialization, City, Hospital, Qualification, Contact, ...
      // We map by header name so order doesn't matter
      const headerMap = {};
      headers.forEach((h, i) => { headerMap[String(h).trim()] = rowData[i]; });

      const approvedRow = approvedHeaders.map(h => headerMap[String(h).trim()] || "");
      approved.appendRow(approvedRow);

      // Update status in Pending to "Approved"
      const statusCol = headers.indexOf("Status") + 1;
      if (statusCol > 0) pending.getRange(row, statusCol).setValue("Approved");

      // Notify doctor
      const emailCol = headers.indexOf("Email") + 1;
      const nameCol  = headers.indexOf("Name")  + 1;
      if (emailCol > 0 && rowData[emailCol - 1]) {
        notifyDoctor(rowData[emailCol - 1], rowData[nameCol - 1], "approved");
      }

      return respond({ status: "ok", message: "Doctor approved and added to directory." });
    }

    // ── REJECT DOCTOR (admin action) ──
    if (payload.action === "reject") {
      const pending = ss.getSheetByName("Pending");
      if (!pending) throw new Error("Pending sheet not found.");

      const row     = parseInt(payload.rowIndex);
      const rowData = pending.getRange(row, 1, 1, pending.getLastColumn()).getValues()[0];
      const headers = pending.getRange(1, 1, 1, pending.getLastColumn()).getValues()[0];

      // Update status to "Rejected"
      const statusCol = headers.indexOf("Status") + 1;
      if (statusCol > 0) pending.getRange(row, statusCol).setValue("Rejected");

      // Notify doctor
      const emailCol = headers.indexOf("Email") + 1;
      const nameCol  = headers.indexOf("Name")  + 1;
      if (emailCol > 0 && rowData[emailCol - 1]) {
        notifyDoctor(rowData[emailCol - 1], rowData[nameCol - 1], "rejected");
      }

      return respond({ status: "ok", message: "Application rejected." });
    }

    // ── ADMIN CRUD (existing) ──
    const sheet = ss.getSheetByName(payload.sheetName || "Sheet1");
    if (!sheet) throw new Error("Sheet not found: " + payload.sheetName);

    if (payload.action === "add") {
      sheet.appendRow(payload.data);
      return respond({ status: "ok", message: "Row added." });
    }
    if (payload.action === "edit") {
      const row   = parseInt(payload.rowIndex);
      const range = sheet.getRange(row, 1, 1, payload.data.length);
      range.setValues([payload.data]);
      return respond({ status: "ok", message: "Row updated." });
    }
    if (payload.action === "delete") {
      sheet.deleteRow(parseInt(payload.rowIndex));
      return respond({ status: "ok", message: "Row deleted." });
    }

    throw new Error("Unknown action: " + payload.action);

  } catch(err) {
    return respond({ status: "error", message: err.message });
  }
}

function doGet(e) {
  return respond({ status: "ok", message: "Apps Script is running." });
}

// ------------------------------------------------------------
//  EMAIL NOTIFICATIONS
// ------------------------------------------------------------
function notifyAdmin(data) {
  try {
    MailApp.sendEmail({
      to:      ADMIN_EMAIL,
      subject: "New Doctor Registration — Rajasthan Doctor Directory",
      body:    "A new doctor has registered and is awaiting approval.\n\n" +
               "Name: "           + (data[0] || "—") + "\n" +
               "Specialization: " + (data[1] || "—") + "\n" +
               "City: "           + (data[2] || "—") + "\n" +
               "Hospital: "       + (data[3] || "—") + "\n" +
               "Contact: "        + (data[5] || "—") + "\n" +
               "Email: "          + (data[6] || "—") + "\n\n" +
               "Please log in to the Admin Panel to review this application."
    });
  } catch(e) {
    Logger.log("Admin notification failed: " + e.message);
  }
}

function notifyDoctor(email, name, status) {
  try {
    const subject = status === "approved"
      ? "Your profile is now live — Rajasthan Doctor Directory"
      : "Update on your registration — Rajasthan Doctor Directory";

    const body = status === "approved"
      ? "Dear Dr. " + name + ",\n\nCongratulations! Your profile has been approved and is now live on the Rajasthan Doctor Directory.\n\nPatients can now find you on the directory.\n\nThank you for joining us."
      : "Dear Dr. " + name + ",\n\nWe have reviewed your registration application. Unfortunately, we were unable to approve your listing at this time.\n\nIf you believe this is an error, please contact us.\n\nThank you for your interest.";

    MailApp.sendEmail({ to: email, subject, body });
  } catch(e) {
    Logger.log("Doctor notification failed: " + e.message);
  }
}

// ------------------------------------------------------------
function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
