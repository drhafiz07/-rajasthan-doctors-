// ============================================================
//  Rajasthan Doctor Directory - Google Apps Script (Full)
//  Handles: register, approve, reject, profile_update,
//           approve_update, reject_update, add, edit, delete
//  Deploy as Web App: Execute as Me, Access Anyone
// ============================================================

const SHEET_ID    = "17qxpKmS93HTabcafybGZdez9nrSN228_cuMOUfxNOBc";
const ADMIN_EMAIL = "your-admin-email@gmail.com";

// ------------------------------------------------------------
//  SETUP - run once to create Pending + Profile Updates tabs
// ------------------------------------------------------------
function setupSheets() {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const msgs = [];

  let pending = ss.getSheetByName("Pending");
  if (!pending) {
    pending = ss.insertSheet("Pending");
    pending.appendRow(["Name","Specialization","City","Hospital","Status","Submitted At"]);
    pending.getRange(1,1,1,6).setFontWeight("bold").setBackground("#5E0819").setFontColor("#FFFFFF");
    pending.setFrozenRows(1);
    msgs.push("Pending tab created.");
  } else {
    msgs.push("Pending tab already exists.");
  }

  let updates = ss.getSheetByName("Profile Updates");
  if (!updates) {
    updates = ss.insertSheet("Profile Updates");
    updates.appendRow(["Email","Name","Requested Changes","Submitted At","Status"]);
    updates.getRange(1,1,1,5).setFontWeight("bold").setBackground("#185FA5").setFontColor("#FFFFFF");
    updates.setFrozenRows(1);
    updates.setColumnWidth(3, 500);
    msgs.push("Profile Updates tab created.");
  } else {
    msgs.push("Profile Updates tab already exists.");
  }

  SpreadsheetApp.getUi().alert("Setup complete!\n\n" + msgs.join("\n"));
}

// ------------------------------------------------------------
//  MAIN POST HANDLER
// ------------------------------------------------------------
function doPost(e) {
  try {
    const raw     = e.postData ? e.postData.contents : "{}";
    const payload = JSON.parse(raw);
    const ss      = SpreadsheetApp.openById(SHEET_ID);

    // ── NEW DOCTOR REGISTRATION ──
    if (payload.action === "register") {
      const pending = ss.getSheetByName("Pending");
      if (!pending) throw new Error("Pending sheet not found. Run setupSheets() first.");

      const data = payload.data;

      // Get existing headers and add any new ones dynamically
      const lastCol = Math.max(pending.getLastColumn(), 1);
      const headers = pending.getRange(1,1,1,lastCol).getValues()[0].map(h => String(h).trim());
      const newKeys = Object.keys(data).filter(k => !headers.includes(k));
      newKeys.forEach(k => headers.push(k));

      if (newKeys.length > 0) {
        pending.getRange(1,1,1,headers.length).setValues([headers]);
        pending.getRange(1,1,1,headers.length).setFontWeight("bold").setBackground("#5E0819").setFontColor("#FFFFFF");
      }

      const row = headers.map(h => data[h] !== undefined ? data[h] : "");
      pending.appendRow(row);
      notifyAdmin(data);
      return respond({ status: "ok", message: "Registration submitted." });
    }

    // ── APPROVE NEW DOCTOR (from Pending tab) ──
    if (payload.action === "approve") {
      const pending  = ss.getSheetByName("Pending");
      const approved = ss.getSheetByName(payload.approvedSheet || "Sheet1");
      if (!pending)  throw new Error("Pending sheet not found.");
      if (!approved) throw new Error("Approved sheet (Sheet1) not found.");

      const pRow      = parseInt(payload.rowIndex);
      const pendHdrs  = pending.getRange(1,1,1,pending.getLastColumn()).getValues()[0].map(h => String(h).trim());
      const rowData   = pending.getRange(pRow,1,1,pending.getLastColumn()).getValues()[0];
      const dataObj   = {};
      pendHdrs.forEach((h,i) => { dataObj[h] = rowData[i]; });

      // Get Sheet1 headers, add missing ones
      const appHdrs = approved.getRange(1,1,1,Math.max(approved.getLastColumn(),1)).getValues()[0].map(h => String(h).trim());
      const missing = pendHdrs.filter(h => h && h !== "Status" && h !== "Submitted At" && !appHdrs.includes(h));
      missing.forEach(h => appHdrs.push(h));
      if (missing.length > 0) {
        approved.getRange(1,1,1,appHdrs.length).setValues([appHdrs]);
        approved.getRange(1,1,1,appHdrs.length).setFontWeight("bold").setBackground("#5E0819").setFontColor("#FFFFFF");
      }

      // Add new row to Sheet1
      const appRow = appHdrs.map(h => dataObj[h] !== undefined ? dataObj[h] : "");
      approved.appendRow(appRow);

      // Notify doctor and delete from Pending
      if (dataObj["Email"]) notifyDoctor(dataObj["Email"], dataObj["Name"] || "", "approved");
      pending.deleteRow(pRow);
      return respond({ status: "ok", message: "Doctor approved and added to directory." });
    }

    // ── REJECT NEW DOCTOR ──
    if (payload.action === "reject") {
      const pending = ss.getSheetByName("Pending");
      if (!pending) throw new Error("Pending sheet not found.");
      const pRow    = parseInt(payload.rowIndex);
      const hdrs    = pending.getRange(1,1,1,pending.getLastColumn()).getValues()[0].map(h => String(h).trim());
      const rowData = pending.getRange(pRow,1,1,pending.getLastColumn()).getValues()[0];
      const eIdx    = hdrs.indexOf("Email");
      const nIdx    = hdrs.indexOf("Name");
      if (eIdx > -1 && rowData[eIdx]) notifyDoctor(rowData[eIdx], rowData[nIdx] || "", "rejected");
      pending.deleteRow(pRow);
      return respond({ status: "ok", message: "Application rejected." });
    }

    // ── PROFILE UPDATE REQUEST (from doctor via My Profile) ──
    if (payload.action === "profile_update") {
      let sheet = ss.getSheetByName("Profile Updates");
      if (!sheet) {
        sheet = ss.insertSheet("Profile Updates");
        sheet.appendRow(["Email","Name","Requested Changes","Submitted At","Status"]);
        sheet.getRange(1,1,1,5).setFontWeight("bold").setBackground("#185FA5").setFontColor("#FFFFFF");
        sheet.setFrozenRows(1);
        sheet.setColumnWidth(3, 500);
      }
      const changes    = payload.changes || {};
      let changesStr   = JSON.stringify(changes);
      if (changesStr.length > 45000) changesStr = changesStr.substring(0, 45000) + "...";
      sheet.appendRow([
        payload.email || "",
        payload.name  || "",
        changesStr,
        new Date().toLocaleString("en-IN"),
        "Pending"
      ]);
      notifyAdminUpdate(payload.name, payload.email);
      return respond({ status: "ok", message: "Update request submitted." });
    }

    // ── APPROVE PROFILE UPDATE ──
    // Finds doctor's EXISTING row in Sheet1 and UPDATES it (does NOT create new row)
    if (payload.action === "approve_update") {
      const updSheet  = ss.getSheetByName("Profile Updates");
      const mainSheet = ss.getSheetByName(payload.sheetName || "Sheet1");
      if (!updSheet)  throw new Error("Profile Updates sheet not found.");
      if (!mainSheet) throw new Error("Sheet1 not found.");

      const updRow = parseInt(payload.rowIndex);
      const email  = (payload.email || "").toLowerCase().trim();

      // Read changes from Profile Updates sheet
      const updHdrs    = updSheet.getRange(1,1,1,updSheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
      const changesIdx = updHdrs.indexOf("Requested Changes");
      if (changesIdx === -1) throw new Error("'Requested Changes' column not found in Profile Updates sheet.");
      const changesRaw = updSheet.getRange(updRow, changesIdx + 1).getValue();

      let changes = {};
      try {
        changes = JSON.parse(changesRaw);
      } catch(e) {
        throw new Error("Cannot parse changes JSON: " + e.message + " | Raw: " + String(changesRaw).substring(0, 100));
      }

      // Find doctor's existing row in Sheet1 by email
      const mainHdrs  = mainSheet.getRange(1,1,1,mainSheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
      const emailIdx  = mainHdrs.indexOf("Email");
      if (emailIdx === -1) throw new Error("Email column not found in Sheet1.");

      const lastDataRow = mainSheet.getLastRow();
      if (lastDataRow < 2) throw new Error("No doctor data found in Sheet1.");

      const allData   = mainSheet.getRange(2, 1, lastDataRow - 1, mainSheet.getLastColumn()).getValues();
      let doctorRowNum = -1;
      for (let i = 0; i < allData.length; i++) {
        if (String(allData[i][emailIdx]).toLowerCase().trim() === email) {
          doctorRowNum = i + 2; // +2 because data starts at row 2
          break;
        }
      }

      if (doctorRowNum === -1) throw new Error("Doctor with email '" + email + "' not found in Sheet1. Has their profile been approved?");

      // UPDATE existing cells (not append new row)
      const skipCols = new Set(["Status","Submitted At","Email","_row"]);
      Object.entries(changes).forEach(([col, val]) => {
        if (skipCols.has(col)) return;
        let colIdx = mainHdrs.indexOf(col);
        if (colIdx === -1) {
          // New column - add to header
          colIdx = mainHdrs.length;
          mainHdrs.push(col);
          mainSheet.getRange(1, colIdx + 1).setValue(col)
            .setFontWeight("bold").setBackground("#5E0819").setFontColor("#FFFFFF");
        }
        // Update the specific cell in doctor's existing row
        mainSheet.getRange(doctorRowNum, colIdx + 1).setValue(val);
      });

      // Mark as Approved in Profile Updates
      const statusIdx = updHdrs.indexOf("Status");
      if (statusIdx > -1) updSheet.getRange(updRow, statusIdx + 1).setValue("Approved");

      // Notify doctor
      if (email) notifyDoctor(email, payload.name || "", "update_approved");
      return respond({ status: "ok", message: "Profile updated successfully in row " + doctorRowNum + "." });
    }

    // ── REJECT PROFILE UPDATE ──
    if (payload.action === "reject_update") {
      const updSheet = ss.getSheetByName("Profile Updates");
      if (!updSheet) throw new Error("Profile Updates sheet not found.");
      const updRow  = parseInt(payload.rowIndex);
      if (isNaN(updRow) || updRow < 2) throw new Error("Invalid row: " + payload.rowIndex);
      const hdrs    = updSheet.getRange(1,1,1,updSheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
      const rowData = updSheet.getRange(updRow,1,1,updSheet.getLastColumn()).getValues()[0];
      const statusIdx = hdrs.indexOf("Status");
      const emailIdx  = hdrs.indexOf("Email");
      const nameIdx   = hdrs.indexOf("Name");
      if (statusIdx > -1) updSheet.getRange(updRow, statusIdx + 1).setValue("Rejected");
      if (emailIdx  > -1 && rowData[emailIdx])  notifyDoctor(rowData[emailIdx], rowData[nameIdx] || "", "update_rejected");
      return respond({ status: "ok", message: "Update rejected." });
    }

    // ── ADMIN CRUD ──
    const sheet = ss.getSheetByName(payload.sheetName || "Sheet1");
    if (!sheet) throw new Error("Sheet not found: " + payload.sheetName);

    if (payload.action === "add") {
      sheet.appendRow(payload.data);
      return respond({ status: "ok", message: "Row added." });
    }
    if (payload.action === "edit") {
      const row = parseInt(payload.rowIndex);
      sheet.getRange(row, 1, 1, payload.data.length).setValues([payload.data]);
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
      subject: "New Doctor Registration - Rajasthan Doctor Directory",
      body:    "A new doctor has registered and is awaiting approval.\n\n" +
               "Name: "           + (data["Name"]           || "-") + "\n" +
               "Specialization: " + (data["Specialization"] || "-") + "\n" +
               "City: "           + (data["City"]           || "-") + "\n" +
               "Hospital: "       + (data["Hospital"]       || "-") + "\n" +
               "Contact (Admin): "+ (data["Contact (Admin)"]|| "-") + "\n" +
               "Email: "          + (data["Email"]          || "-") + "\n\n" +
               "Please log in to the Admin Panel to review this application."
    });
  } catch(e) { Logger.log("Admin notify failed: " + e.message); }
}

function notifyAdminUpdate(name, email) {
  try {
    MailApp.sendEmail({
      to:      ADMIN_EMAIL,
      subject: "Profile Update Request - " + (name || "Unknown Doctor"),
      body:    "Dr. " + (name || "") + " (" + (email || "") + ") has submitted a profile update request.\n\nPlease log in to the Admin Panel -> Profile Updates tab to review the changes."
    });
  } catch(e) { Logger.log("Admin update notify failed: " + e.message); }
}

function notifyDoctor(email, name, status) {
  try {
    let subject, body;
    if (status === "approved") {
      subject = "Your profile is now live - Rajasthan Doctor Directory";
      body    = "Dear Dr. " + name + ",\n\nCongratulations! Your profile has been approved and is now live.\n\nThank you for joining us.";
    } else if (status === "rejected") {
      subject = "Update on your registration - Rajasthan Doctor Directory";
      body    = "Dear Dr. " + name + ",\n\nWe reviewed your registration but were unable to approve it at this time.\n\nPlease contact us if you believe this is an error.";
    } else if (status === "update_approved") {
      subject = "Profile update approved - Rajasthan Doctor Directory";
      body    = "Dear Dr. " + name + ",\n\nYour profile update has been approved and your listing has been updated on the directory.\n\nYour updated profile is now visible to the public.";
    } else if (status === "update_rejected") {
      subject = "Profile update not approved - Rajasthan Doctor Directory";
      body    = "Dear Dr. " + name + ",\n\nWe reviewed your profile update request but were unable to apply the changes at this time.\n\nPlease contact us for more information.";
    }
    if (subject && body) MailApp.sendEmail({ to: email, subject, body });
  } catch(e) { Logger.log("Doctor notify failed: " + e.message); }
}

function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
