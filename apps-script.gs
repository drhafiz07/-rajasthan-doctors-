// ============================================================
//  Rajasthan Doctor Directory - Google Apps Script (Full)
//  Handles: add, edit, delete, register (dynamic), approve, reject
//  Deploy as Web App → Execute as: Me → Access: Anyone
// ============================================================

const SHEET_ID    = "17qxpKmS93HTabcafybGZdez9nrSN228_cuMOUfxNOBc";
const ADMIN_EMAIL = "your-admin-email@gmail.com";  // ← change this

// Run ONCE manually to create Pending tab
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let msgs = [];

  // Create Pending tab
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

  // Create Profile Updates tab
  let updates = ss.getSheetByName("Profile Updates");
  if (!updates) {
    updates = ss.insertSheet("Profile Updates");
    updates.appendRow(["Email","Name","Requested Changes","Submitted At","Status","Admin Notes"]);
    updates.getRange(1,1,1,6).setFontWeight("bold").setBackground("#185FA5").setFontColor("#FFFFFF");
    updates.setFrozenRows(1);
    updates.setColumnWidth(3, 400); // wider column for changes
    msgs.push("Profile Updates tab created.");
  } else {
    msgs.push("Profile Updates tab already exists.");
  }

  SpreadsheetApp.getUi().alert("Setup complete!\n\n" + msgs.join("\n"));
}

function doPost(e) {
  try {
    const raw     = e.postData ? e.postData.contents : "{}";
    const payload = JSON.parse(raw);
    const ss      = SpreadsheetApp.openById(SHEET_ID);

    // ── DOCTOR SELF-REGISTRATION (dynamic key-value) ──
    if (payload.action === "register") {
      const pending = ss.getSheetByName("Pending");
      if (!pending) throw new Error("Pending sheet not found. Please run setupSheets() first.");

      const data = payload.data; // object: {Name:"...", Specialization:"...", Work1_Hospital:"...", ...}

      // Get existing headers
      const lastCol     = Math.max(pending.getLastColumn(), 1);
      const headerRange = pending.getRange(1, 1, 1, lastCol);
      const headers     = headerRange.getValues()[0].map(h => String(h).trim());

      // Find new keys not yet in headers - add them as new columns
      const newKeys = Object.keys(data).filter(k => !headers.includes(k));
      newKeys.forEach(k => headers.push(k));

      // Update header row with any new columns
      if (newKeys.length > 0) {
        pending.getRange(1, 1, 1, headers.length).setValues([headers]);
        pending.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#5E0819").setFontColor("#FFFFFF");
      }

      // Build row matching header order
      const row = headers.map(h => data[h] !== undefined ? data[h] : "");
      pending.appendRow(row);

      // Notify admin
      notifyAdmin(data);
      return respond({ status: "ok", message: "Registration submitted." });
    }

    // ── APPROVE ──
    if (payload.action === "approve") {
      const pending  = ss.getSheetByName("Pending");
      const approved = ss.getSheetByName(payload.approvedSheet || "Sheet1");
      if (!pending)  throw new Error("Pending sheet not found.");
      if (!approved) throw new Error("Approved sheet not found.");

      const row         = parseInt(payload.rowIndex);
      const pendingHdrs = pending.getRange(1,1,1,pending.getLastColumn()).getValues()[0].map(h=>String(h).trim());
      const rowData     = pending.getRange(row,1,1,pending.getLastColumn()).getValues()[0];

      // Build data object from pending row
      const dataObj = {};
      pendingHdrs.forEach((h,i)=>{ dataObj[h] = rowData[i]; });

      // Get approved sheet headers
      const approvedHdrs = approved.getRange(1,1,1,Math.max(approved.getLastColumn(),1)).getValues()[0].map(h=>String(h).trim());

      // Add any missing columns to approved sheet
      const missingHdrs = pendingHdrs.filter(h => h && h!=="Status" && h!=="Submitted At" && !approvedHdrs.includes(h));
      missingHdrs.forEach(h => approvedHdrs.push(h));
      if (missingHdrs.length > 0) {
        approved.getRange(1,1,1,approvedHdrs.length).setValues([approvedHdrs]);
        approved.getRange(1,1,1,approvedHdrs.length).setFontWeight("bold").setBackground("#5E0819").setFontColor("#FFFFFF");
      }

      // Build approved row
      const approvedRow = approvedHdrs.map(h => dataObj[h] !== undefined ? dataObj[h] : "");
      approved.appendRow(approvedRow);

      // Notify doctor
      if (dataObj["Email"]) notifyDoctor(dataObj["Email"], dataObj["Name"] || "", "approved");

      // Delete from pending
      pending.deleteRow(row);
      return respond({ status: "ok", message: "Doctor approved." });
    }

    // ── REJECT ──
    if (payload.action === "reject") {
      const pending = ss.getSheetByName("Pending");
      if (!pending) throw new Error("Pending sheet not found.");
      const row     = parseInt(payload.rowIndex);
      const hdrs    = pending.getRange(1,1,1,pending.getLastColumn()).getValues()[0].map(h=>String(h).trim());
      const rowData = pending.getRange(row,1,1,pending.getLastColumn()).getValues()[0];
      const emailIdx = hdrs.indexOf("Email");
      const nameIdx  = hdrs.indexOf("Name");
      if (emailIdx > -1 && rowData[emailIdx]) notifyDoctor(rowData[emailIdx], rowData[nameIdx]||"", "rejected");
      pending.deleteRow(row);
      return respond({ status: "ok", message: "Application rejected." });
    }

    // ── PROFILE UPDATE REQUEST (from My Profile) ──
    if (payload.action === "profile_update") {
      let sheet = ss.getSheetByName("Profile Updates");
      if (!sheet) {
        sheet = ss.insertSheet("Profile Updates");
        sheet.appendRow(["Email","Name","Requested Changes","Submitted At","Status"]);
        sheet.getRange(1,1,1,5).setFontWeight("bold").setBackground("#185FA5").setFontColor("#FFFFFF");
        sheet.setFrozenRows(1);
        sheet.setColumnWidth(3, 500);
      }
      const changes = payload.changes || {};
      // Convert changes to readable string, max 45000 chars (Sheets cell limit)
      let changesStr = JSON.stringify(changes);
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
    if (payload.action === "approve_update") {
      const updSheet  = ss.getSheetByName("Profile Updates");
      const mainSheet = ss.getSheetByName(payload.sheetName || "Sheet1");
      if (!updSheet)  throw new Error("Profile Updates sheet not found.");
      if (!mainSheet) throw new Error("Main sheet not found.");

      const row      = parseInt(payload.rowIndex);
      const email    = (payload.email || "").toLowerCase().trim();

      // Read changes directly from the Profile Updates sheet row
      const updHdrs  = updSheet.getRange(1,1,1,updSheet.getLastColumn()).getValues()[0].map(h=>String(h).trim());
      const changesIdx = updHdrs.indexOf("Requested Changes") + 1;
      if (changesIdx === 0) throw new Error("Requested Changes column not found in Profile Updates sheet.");
      const changesRaw = updSheet.getRange(row, changesIdx).getValue();
      let changes = {};
      try { changes = JSON.parse(changesRaw); } catch(e) { throw new Error("Could not parse changes JSON: " + e.message); }

      // Find the doctor row in Sheet1 by email
      const hdrs    = mainSheet.getRange(1,1,1,mainSheet.getLastColumn()).getValues()[0].map(h=>String(h).trim());
      const emailIdx = hdrs.indexOf("Email");
      if (emailIdx === -1) throw new Error("Email column not found in Sheet1.");

      const dataRange = mainSheet.getRange(2,1,mainSheet.getLastRow()-1,mainSheet.getLastColumn()).getValues();
      let doctorRow = -1;
      dataRange.forEach((row,i) => {
        if (String(row[emailIdx]).toLowerCase().trim() === email) doctorRow = i + 2;
      });

      if (doctorRow === -1) throw new Error("Doctor not found in directory with email: " + email);

      // Apply each change to the correct column
      Object.entries(changes).forEach(([col, val]) => {
        let colIdx = hdrs.indexOf(col);
        if (colIdx === -1) {
          // Add new column if not found
          colIdx = hdrs.length;
          hdrs.push(col);
          mainSheet.getRange(1, colIdx+1).setValue(col).setFontWeight("bold").setBackground("#5E0819").setFontColor("#FFFFFF");
        }
        mainSheet.getRange(doctorRow, colIdx+1).setValue(val);
      });

      // Mark as Approved in Profile Updates sheet
      const statusIdx2 = updHdrs.indexOf("Status") + 1;
      if (statusIdx2 > 0) updSheet.getRange(row, statusIdx2).setValue("Approved");

      // Notify doctor
      if (email) notifyDoctor(email, payload.name||"", "update_approved");
      return respond({ status: "ok", message: "Profile update approved and applied." });
    }

    // ── REJECT PROFILE UPDATE ──
    if (payload.action === "reject_update") {
      const updSheet = ss.getSheetByName("Profile Updates");
      if (!updSheet) throw new Error("Profile Updates sheet not found.");
      const row = parseInt(payload.rowIndex);
      if (isNaN(row) || row < 2) throw new Error("Invalid row index: " + payload.rowIndex);
      const lastRow = updSheet.getLastRow();
      if (row > lastRow) throw new Error("Row " + row + " does not exist. Sheet has " + lastRow + " rows.");
      const lastCol  = updSheet.getLastColumn();
      const hdrs     = updSheet.getRange(1,1,1,lastCol).getValues()[0].map(h=>String(h).trim());
      const statusIdx = hdrs.indexOf("Status") + 1;
      const emailIdx  = hdrs.indexOf("Email") + 1;
      const nameIdx   = hdrs.indexOf("Name")  + 1;
      const rowData   = updSheet.getRange(row,1,1,lastCol).getValues()[0];
      // Mark as Rejected (do NOT delete row - prevents index shift errors)
      if (statusIdx > 0) updSheet.getRange(row, statusIdx).setValue("Rejected");
      if (emailIdx > 0 && rowData[emailIdx-1]) {
        notifyDoctor(rowData[emailIdx-1], rowData[nameIdx-1]||"", "update_rejected");
      }
      return respond({ status: "ok", message: "Profile update rejected." });
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

function notifyAdmin(data) {
  try {
    MailApp.sendEmail({
      to: ADMIN_EMAIL,
      subject: "New Doctor Registration - Rajasthan Doctor Directory",
      body: "A new doctor has registered and is awaiting approval.\n\n" +
            "Name: "           + (data["Name"]           || "-") + "\n" +
            "Specialization: " + (data["Specialization"] || "-") + "\n" +
            "City: "           + (data["City"]           || "-") + "\n" +
            "Hospital: "       + (data["Hospital"]       || "-") + "\n" +
            "Contact (Admin): "+ (data["Contact (Admin)"]|| "-") + "\n" +
            "Email: "          + (data["Email"]          || "-") + "\n\n" +
            "Please log in to the Admin Panel to review this application.\n\n" +
            "Note: Social media links and CV details are stored in dynamic columns in the Pending sheet."
    });
  } catch(e) { Logger.log("Admin notify failed: " + e.message); }
}

function notifyAdminUpdate(name, email) {
  try {
    MailApp.sendEmail({
      to: ADMIN_EMAIL,
      subject: "Profile Update Request - " + (name || "Unknown Doctor"),
      body: "Dr. " + (name||"") + " (" + (email||"") + ") has requested a profile update.\n\nPlease log in to the Admin Panel to review and approve the changes."
    });
  } catch(e) { Logger.log("Admin update notify failed: " + e.message); }
}

function notifyDoctor(email, name, status) {
  try {
    let subject, body;
    if (status === "approved") {
      subject = "Your profile is now live - Rajasthan Doctor Directory";
      body = "Dear Dr. " + name + ",\n\nCongratulations! Your profile has been approved and is now live on the Rajasthan Doctor Directory.\n\nThank you for joining us.";
    } else if (status === "rejected") {
      subject = "Update on your registration - Rajasthan Doctor Directory";
      body = "Dear Dr. " + name + ",\n\nWe reviewed your registration but were unable to approve your listing at this time.\n\nPlease contact us if you believe this is an error.";
    } else if (status === "update_approved") {
      subject = "Profile update approved - Rajasthan Doctor Directory";
      body = "Dear Dr. " + name + ",\n\nYour profile update request has been approved and your listing has been updated on the Rajasthan Doctor Directory.\n\nYour updated profile is now visible to the public.";
    } else if (status === "update_rejected") {
      subject = "Profile update not approved - Rajasthan Doctor Directory";
      body = "Dear Dr. " + name + ",\n\nWe reviewed your profile update request but were unable to apply the changes at this time.\n\nPlease contact us for more information.";
    }
    if (subject && body) MailApp.sendEmail({ to: email, subject, body });
  } catch(e) { Logger.log("Doctor notify failed: " + e.message); }
}

function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
