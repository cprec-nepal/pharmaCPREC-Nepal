/**
 * CPREC MCQ System - Apps Script backend (Web App)
 * -------------------------------------------------
 * Deployed as a Google Apps Script Web App; the frontend (index.html) calls it
 * through the API URL defined there.
 *
 * REQUIRED GOOGLE SHEET LAYOUT
 * =============================
 * The code reads MCQ rows by COLUMN INDEX. The FIRST column of the "MCQs" tab
 * MUST be "Subject" (separate from "College Name"), otherwise every field is
 * shifted by one and the quiz renders garbage.
 *
 * MCQs tab (row 1 = headers, data from row 2) — column ORDER is what matters:
 *   A: Subject        B: College Name     C: QNumber
 *   D: Question       E: Option A         F: Option B
 *   G: Option C       H: Option D         I: Correct Answer
 *   J: Image URL      K: Explanation*     L: Correct Text*
 *   M: Feedback A     N: Feedback B       O: Feedback C       P: Feedback D
 *   (* backend reads column K as `explanation`, L as `correctText`; the sheet
 *      header names are flexible — only the position/index matters.)
 *
 * Backend column mapping (r[N] = 0-based column index):
 *   r[0]=subject, r[1]=college, r[2]=qnumber, r[3]=q,
 *   r[4..7]=options A–D, r[8]=answer, r[9]=image,
 *   r[10]=explanation, r[11]=correctText, r[12..15]=feedback A–D
 *
 * EmailVerifications tab: column 0 MUST be "Email" (then Code, Status, ...).
 * (See the header comment block inside handleRequest() for the full
 *  EmailVerifications column contract used by getProfile / verifyCode.)
 *
 * Other tabs referenced: EmailVerifications, CodeBackups, DeniedLogins,
 * QuizHistory, AdminSettings, UserActivity, PendingRequests, Referrals.
 */
function doGet(e) { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    // --- CONFIGURATION ---
    const SS_ID = "1o3YSXEoqSSiMdZ2oUsjefezrPU7CStd8DxBBwGtOegA";
    // Your provided Drive Folder ID for Avatars
    const DRIVE_FOLDER_ID = "1GTPWmvd2bf2gWCuAd1jVkd2LyybZ5zJl"; 
    
    const ss = SpreadsheetApp.openById(SS_ID);

    // --- INITIALIZE SHEETS ---
    const sheets = {
      mcq: ss.getSheetByName("MCQs"),
      verify: ss.getSheetByName("EmailVerifications"),
      backup: ss.getSheetByName("CodeBackups"),
      deny: ss.getSheetByName("DeniedLogins") || ss.insertSheet("DeniedLogins"),
      history: ss.getSheetByName("QuizHistory") || ss.insertSheet("QuizHistory"),
      admin: ss.getSheetByName("AdminSettings") || ss.insertSheet("AdminSettings"),
      activity: ss.getSheetByName("UserActivity"),
      pending: ss.getSheetByName("PendingRequests") || ss.insertSheet("PendingRequests"),
      referrals: ss.getSheetByName("Referrals") || ss.insertSheet("Referrals")
    };

    // --- ENSURE HEADERS ---
    // Standardizing the Verify Sheet Structure (Indices 0-19):
    // 0:Email, 1:Code, 2:Status, 3:Date, 4:Token, 5:Count, 6:Blocked, 7:Online, 8:Activity, 9:Role, 
    // 10:Name, 11:LoginTime, 12:LastActive, 13:Duration, 14:Password, 
    // 15:Avatar, 16:Phone, 17:College, 18:RefCode, 19:RefCount
    
    if (sheets.history.getLastRow() === 0) sheets.history.appendRow(["Date", "Email", "Subject", "College", "Score", "Total", "Percentage"]);
    if (sheets.pending.getLastRow() === 0) sheets.pending.appendRow(["Date", "Email", "IP", "Location", "Status", "ReferralCode"]);
    if (sheets.admin.getLastRow() === 0) sheets.admin.appendRow(["Email", "FullName", "Status", "Role", "Token", "Password", "CreatedOn"]);
    if (sheets.deny.getLastRow() === 0) sheets.deny.appendRow(["Date", "IP", "Location", "Reason"]);
    if (sheets.referrals.getLastRow() === 0) sheets.referrals.appendRow(["Date", "Referrer", "ReferredEmail", "Status"]);

    const type = e.parameter.type;

    // --- HELPERS ---
    function sendJSON(obj) {
      return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
    }

    function getUserRow(email) {
      const data = sheets.verify.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === email) return i + 1; // 1-based index
      }
      return -1;
    }

    function isAdmin(email, token) {
      if (!email || !token) return false;
      const adminData = sheets.admin.getDataRange().getValues();
      for (let i = 1; i < adminData.length; i++) {
        if (adminData[i][0] === email && adminData[i][4] === token && adminData[i][3] === "Admin") return true;
      }
      const verifyData = sheets.verify.getDataRange().getValues();
      for (let i = 1; i < verifyData.length; i++) {
        if (verifyData[i][0] === email && verifyData[i][4] === token && verifyData[i][9] === "Admin") return true;
      }
      return false;
    }

    function isSuperAdmin(email) {
      const supers = ["admin@cprecnepal.org.np", "manish.pharma0512@gmail.com"];
      return supers.includes(email);
    }

    function generatePassword() {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let pass = "";
      for (let i = 0; i < 8; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
      return pass;
    }

    function generateReferralCode(email) {
      const name = email.split('@')[0].toUpperCase().substring(0, 4);
      const num = Math.floor(1000 + Math.random() * 9000);
      return name + num;
    }

    // =========================================
    // 1. PROFILE & SETTINGS ENDPOINTS
    // =========================================

    // GET PROFILE DATA
    if (type === "getProfile") {
      const { email, token } = e.parameter;
      const rowIdx = getUserRow(email);
      if (rowIdx === -1) return sendJSON({ success: false, message: "User not found" });

      const rows = sheets.verify.getDataRange().getValues();
      const userData = rows[rowIdx - 1];

      // Validate Token (Col 4 / Index 4)
      if (userData[4] !== token) return sendJSON({ success: false, message: "Unauthorized" });

      return sendJSON({
        success: true,
        profile: {
          email: userData[0],
          fullName: userData[10] || email.split('@')[0],
          phone: userData[16] || "",
          college: userData[17] || "",
          avatar: userData[15] || "",
          referralCode: userData[18] || generateReferralCode(email),
          referralsCount: userData[19] || 0
        }
      });
    }

    // UPDATE PROFILE (Name, Phone, College, Password)
    if (type === "updateProfile") {
      const { email, token, fullName, phone, college, newPassword } = e.parameter;
      const rowIdx = getUserRow(email);
      if (rowIdx === -1) return sendJSON({ success: false, message: "User not found" });

      const rows = sheets.verify.getDataRange().getValues();
      if (rows[rowIdx - 1][4] !== token) return sendJSON({ success: false, message: "Unauthorized" });

      if (fullName) sheets.verify.getRange(rowIdx, 11).setValue(fullName); // Col K
      if (phone) sheets.verify.getRange(rowIdx, 17).setValue(phone);       // Col Q
      if (college) sheets.verify.getRange(rowIdx, 18).setValue(college);   // Col R
      
      // Update Password if provided (Optional)
      if (newPassword && newPassword.length >= 4) {
        sheets.verify.getRange(rowIdx, 15).setValue(newPassword); // Col O
        // Also update in Admin sheet if exists
        const adminRows = sheets.admin.getDataRange().getValues();
        for(let i=1; i<adminRows.length; i++) {
          if(adminRows[i][0] === email) {
            sheets.admin.getRange(i+1, 6).setValue(newPassword);
          }
        }
      }
      
      // Ensure Referral Code exists
      if (!rows[rowIdx - 1][18]) {
        sheets.verify.getRange(rowIdx, 19).setValue(generateReferralCode(email));
      }

      return sendJSON({ success: true, message: "Profile updated successfully" });
    }

    // UPLOAD AVATAR TO DRIVE
    if (type === "uploadAvatar") {
      const { email, token, base64Data, mimeType } = e.parameter;
      const rowIdx = getUserRow(email);
      if (rowIdx === -1) return sendJSON({ success: false, message: "User not found" });

      const rows = sheets.verify.getDataRange().getValues();
      if (rows[rowIdx - 1][4] !== token) return sendJSON({ success: false, message: "Unauthorized" });
      
      const fullName = rows[rowIdx - 1][10] || email.split('@')[0];

      try {
        // Decode Base64
        const decoded = Utilities.base64Decode(base64Data);
        const blob = Utilities.newBlob(decoded, mimeType);
        
        // Format: NAME_Email_Photo.jpg
        const cleanEmail = email.replace(/[^a-zA-Z0-9]/g, '_');
        const cleanName = fullName.replace(/[^a-zA-Z0-9]/g, '_');
        const fileName = `${cleanName}_${cleanEmail}_Photo`;
        
        // Save to Drive
        const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
        const file = folder.createFile(blob.setName(fileName));
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        
        const fileId = file.getId();
        const avatarUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;
        
        // Save URL to Sheet (Col P / Index 15)
        sheets.verify.getRange(rowIdx, 16).setValue(avatarUrl);
        
        return sendJSON({ success: true, url: avatarUrl });
      } catch (err) {
        return sendJSON({ success: false, message: "Drive Error: " + err.toString() });
      }
    }

    // APPLY REFERRAL
    if (type === "applyReferral") {
      const { email, token, code } = e.parameter;
      const rowIdx = getUserRow(email);
      if (rowIdx === -1) return sendJSON({ success: false, message: "User not found" });

      // Find Referrer
      const data = sheets.verify.getDataRange().getValues();
      let referrerEmail = "";
      
      for (let i = 1; i < data.length; i++) {
        // Col S (Index 18) is Referral Code
        if (data[i][18] === code) {
          referrerEmail = data[i][0];
          break;
        }
      }
      
      if (!referrerEmail) return sendJSON({ success: false, message: "Invalid Referral Code" });
      if (referrerEmail === email) return sendJSON({ success: false, message: "Cannot refer yourself" });

      // Log Referral
      sheets.referrals.appendRow([new Date(), referrerEmail, email, "Success"]);
      
      // Increment Referrer's Count (Col T / Index 19)
      const refRow = getUserRow(referrerEmail);
      if (refRow > 0) {
        const currentCount = data[refRow - 1][19] || 0;
        sheets.verify.getRange(refRow, 20).setValue(currentCount + 1);
      }
      
      return sendJSON({ success: true, message: "Referral applied successfully!" });
    }

    // =========================================
    // 2. AUTHENTICATION FLOWS
    // =========================================

    // REGISTER USER (Request Only)
    if (type === "registerUser") {
      const { email, ip, location, referralCode } = e.parameter;
      if (!email) return sendJSON({ success: false, message: "Missing email" });

      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(com|org|edu|net|gov|np|org\.np)$/;
      if (!emailRegex.test(email)) return sendJSON({ success: false, message: "Invalid email format" });

      const rows = sheets.verify.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === email) return sendJSON({ success: false, message: "Email already registered." });
      }

      const pendingData = sheets.pending.getDataRange().getValues();
      for(let i=1; i<pendingData.length; i++) {
        if(pendingData[i][1] === email && pendingData[i][4] !== "Approved") {
           return sendJSON({ success: false, message: "Request already pending approval." });
        }
      }

      // Log to Pending (Col F stores referral code used during registration)
      sheets.pending.appendRow([new Date(), email, ip, location, "Pending", referralCode || ""]);
      return sendJSON({ success: true, message: "Request sent to Admin. Please wait for approval email." });
    }

    // ADMIN: APPROVE USER
    if (type === "approveUser") {
      const { email, token, targetEmail } = e.parameter;
      if (!isAdmin(email, token)) return sendJSON({ success: false, message: "Unauthorized" });

      const pendingData = sheets.pending.getDataRange().getValues();
      let pendingRowIdx = -1;

      for(let i=1; i<pendingData.length; i++) {
        if(pendingData[i][1] === targetEmail && pendingData[i][4] === "Pending") {
          pendingRowIdx = i + 1;
          break;
        }
      }
      if (pendingRowIdx === -1) return sendJSON({ success: false, message: "Pending request not found." });

      const verifyRows = sheets.verify.getDataRange().getValues();
      for(let i=1; i<verifyRows.length; i++) {
        if(verifyRows[i][0] === targetEmail) return sendJSON({ success: false, message: "User already exists." });
      }

      // GENERATE CREDENTIALS
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const password = generatePassword();
      const refCode = generateReferralCode(targetEmail);

      // Append to EmailVerifications (Standardized Columns)
      // 0:Email, 1:Code, 2:Status, 3:Date, 4:Token, 5:Count, 6:Blocked, 7:Online, 8:Activity, 9:Role, 
      // 10:Name, 11:LoginTime, 12:LastActive, 13:Duration, 14:Password, 15:Avatar, 16:Phone, 17:College, 18:RefCode, 19:RefCount
      sheets.verify.appendRow([
        targetEmail, code, "Pending", new Date(), "", 0, "", "No", "", "User", 
        targetEmail.split('@')[0], "", "", "", password, 
        "", "", "", refCode, 0
      ]);

      // Update Pending Status
      sheets.pending.getRange(pendingRowIdx, 5).setValue("Approved");

      // Send Email
      const senderEmail = "no-reply@mcqs.cprecnepal.org.np";
      try {
        GmailApp.sendEmail(targetEmail, "Account Approved - CPREC Nepal", "", {
          from: senderEmail,
          name: "MCQS Study Portal - CPREC Nepal",
          replyTo: senderEmail,
          htmlBody: `
            <div style="font-family:Arial,Helvetica,sans-serif; max-width:600px; margin:auto; padding:24px; border:1px solid #e5e7eb; border-radius:12px; background:#ffffff; color:#111827;">
              <h2 style="color:#2563eb; text-align:center;">Account Approved!</h2>
              <p>Your request has been approved. Here are your login details:</p>
              <div style="background:#f3f4f6; padding:15px; border-radius:8px; margin: 20px 0;">
                <p style="margin:0; font-weight:bold;">Email:</p>
                <p style="margin:0 0 15px 0; color:#4b5563;">${targetEmail}</p>
                <p style="margin:0; font-weight:bold;">Generated Password:</p>
                <p style="margin:0 0 15px 0; color:#ef4444; font-size:1.2em; font-family:monospace;">${password}</p>
              </div>
              <p>Use the temporary code below to verify your email and set a new password:</p>
              <div style="text-align:center; margin:30px 0;">
                <span style="font-size:28px; font-weight:bold; background:#e0f2fe; padding:14px 28px; border-radius:10px; color:#111;">${code}</span>
              </div>
              <p style="font-size:13px; color:#6b7280;">This password is optional. You can always login via OTP or change it in settings.</p>
            </div>
          `
        });
        return sendJSON({ success: true, message: "User approved and credentials sent." });
      } catch (err) { return sendJSON({ success: false, message: "Email failed: " + err.toString() }); }
    }

    // ADMIN: GET PENDING USERS
    if (type === "getPendingUsers") {
      const { email, token } = e.parameter;
      if (!isAdmin(email, token)) return sendJSON({ success: false, message: "Unauthorized" });

      const data = sheets.pending.getDataRange().getValues();
      const pending = [];
      for(let i=1; i<data.length; i++) {
        if(data[i][4] === "Pending") {
          pending.push({
            date: data[i][0],
            email: data[i][1],
            ip: data[i][2],
            location: data[i][3]
          });
        }
      }
      return sendJSON({ success: true, pending });
    }

    // SEND CODE (For Existing Users)
    if (type === "sendCode") {
      const { email, ip, location } = e.parameter;
      if (!email) return sendJSON({ success: false, message: "Missing email" });

      const rows = sheets.verify.getDataRange().getValues();
      let foundRow = -1, isBlocked = false;

      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === email) {
          foundRow = i + 1;
          if (rows[i][6] === "Blocked") isBlocked = true;
          break;
        }
      }

      if (foundRow === -1) {
        sheets.deny.appendRow([new Date(), ip || "", location || "", "Not Registered: " + email]);
        return sendJSON({ success: false, message: "🚫 Email not found. Please register first." });
      }

      if (isBlocked) return sendJSON({ success: false, message: "🚫 Account is blocked." });

      const lastSent = rows[foundRow - 1][3];
      if (lastSent) {
        const now = new Date();
        if ((now - new Date(lastSent)) < 60000) return sendJSON({ success: false, message: "Please wait 60 seconds." });
      }

      const code = Math.floor(100000 + Math.random() * 900000);
      sheets.verify.getRange(foundRow, 2).setValue(code);
      sheets.verify.getRange(foundRow, 3).setValue("Pending");
      sheets.verify.getRange(foundRow, 4).setValue(new Date());
      sheets.verify.getRange(foundRow, 5).setValue("");
      sheets.verify.getRange(foundRow, 8).setValue("No");

      if (sheets.backup) sheets.backup.appendRow([email, code, new Date(), "", ip, location]);

      const senderEmail = "no-reply@mcqs.cprecnepal.org.np";
      try {
        GmailApp.sendEmail(email, "Your Login Code – CPREC Nepal", "", {
          from: senderEmail, name: "MCQS Study Portal - CPREC Nepal", replyTo: senderEmail,
          htmlBody: `<div style="font-family:Arial,sans-serif; text-align:center;"><h2>Login Code</h2><p style="font-size:24px; font-weight:bold;">${code}</p></div>`
        });
      } catch (err) { return sendJSON({ success: false, message: "Email failed to send." }); }

      return sendJSON({ success: true, message: "Verification code sent" });
    }

    // VERIFY CODE / PASSWORD
    if (type === "verifyCode") {
      const method = e.parameter.method || 'code'; 
      const email = e.parameter.email;
      const secret = e.parameter.code;
      const ip = e.parameter.ip || "";
      const location = e.parameter.location || "";

      let isValid = false;
      let role = "User";
      let fullName = email.split('@')[0];
      let avatar = "";
      let foundRowIdx = -1;

      const rows = sheets.verify.getDataRange().getValues();

      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === email) {
          foundRowIdx = i + 1;
          if (rows[i][6] === "Blocked") return sendJSON({ success: false, message: "🚫 Account is blocked." });
          role = rows[i][9] || "User";
          fullName = rows[i][10] || fullName;
          avatar = rows[i][15] || "";
          break;
        }
      }

      if (foundRowIdx === -1) return sendJSON({ success: false, message: "User not found" });

      if (method === 'password') {
        let adminPass = "";
        const adminData = sheets.admin.getDataRange().getValues();
        for (let j = 1; j < adminData.length; j++) {
          if (adminData[j][0] === email) adminPass = adminData[j][5];
        }
        const userPass = rows[foundRowIdx - 1][14]; // Col O

        if (secret === adminPass || secret === userPass) {
          isValid = true;
        } else {
          return sendJSON({ success: false, message: "Invalid email or password." });
        }
      } else {
        if (rows[foundRowIdx - 1][1].toString() !== secret.toString()) {
          return sendJSON({ success: false, message: "Invalid Code" });
        }
        isValid = true;
      }

      if (isValid) {
        const token = Utilities.getUuid();
        const now = new Date();

        sheets.verify.getRange(foundRowIdx, 3).setValue("Verified");
        sheets.verify.getRange(foundRowIdx, 4).setValue(now);
        sheets.verify.getRange(foundRowIdx, 5).setValue(token);
        sheets.verify.getRange(foundRowIdx, 8).setValue("Yes");
        
        let loginCount = (Number(rows[foundRowIdx - 1][5]) || 0) + 1;
        sheets.verify.getRange(foundRowIdx, 6).setValue(loginCount);
        sheets.verify.getRange(foundRowIdx, 12).setValue(now);

        // Sync Admin Token
        const adminData = sheets.admin.getDataRange().getValues();
        for (let k = 1; k < adminData.length; k++) {
          if (adminData[k][0] === email) sheets.admin.getRange(k + 1, 5).setValue(token);
        }

        logActivity(sheets.activity, email, "Login", token, ip, location);

        return sendJSON({ success: true, token: token, role: role, email: email, fullName: fullName, avatar: avatar });
      }
    }

    // =========================================
    // 3. QUIZ & USER ENDPOINTS
    // =========================================
    if (type === "getFilters") {
      const data = sheets.mcq.getDataRange().getValues();
      data.shift();
      const subjects = [...new Set(data.map(r => r[0]).filter(Boolean))].sort();
      const colleges = [...new Set(data.map(r => r[1]).filter(Boolean))].sort();
      return sendJSON({ success: true, subjects, colleges });
    }

    if (type === "getMCQs") {
      const data = sheets.mcq.getDataRange().getValues();
      const mcqs = data.slice(1).map(r => ({
        id: r[2], subject: r[0], college: r[1], qnumber: r[2], q: r[3],
        options: [r[4], r[5], r[6], r[7]], answer: r[8], image: r[9], explanation: r[10],
        correctText: r[11], feedback: { A: r[12], B: r[13], C: r[14], D: r[15] } 
      }));
      return sendJSON({ success: true, mcqs });
    }

    if (type === "saveScore") {
      const { email, subject, college, score, total, percentage } = e.parameter;
      sheets.history.appendRow([new Date(), email, subject, college, score, total, percentage]);
      return sendJSON({ success: true, message: "Score saved" });
    }

    // =========================================
    // 4. ADMIN ENDPOINTS
    // =========================================
    if (type === "getUsers") {
      const { email, token } = e.parameter;
      if (!isAdmin(email, token)) return sendJSON({ success: false, message: "Unauthorized" });
      const rows = sheets.verify.getDataRange().getValues();
      const users = rows.slice(1).map(r => ({
        email: r[0], status: r[2], verifiedOn: r[3] ? new Date(r[3]).toLocaleString() : "",
        isBlocked: r[6] === "Blocked", loginCount: r[5] || 0, activeStatus: r[7] === "Yes" ? "Online" : "Offline",
        currentActivity: r[8] || "Idle", role: r[9] || "User", fullName: r[10] || "",
        loginTime: r[11] ? new Date(r[11]).toLocaleString() : "", lastActive: r[12] ? new Date(r[12]).toLocaleString() : "", duration: r[13] || "--",
        avatar: r[15] || ""
      }));
      return sendJSON({ success: true, users });
    }

    if (type === "toggleBlock") {
      const { email, token, targetEmail } = e.parameter;
      if (!isAdmin(email, token)) return sendJSON({ success: false, message: "Unauthorized" });
      const rows = sheets.verify.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === targetEmail) {
          const newVal = (rows[i][6] === "Blocked") ? "" : "Blocked";
          sheets.verify.getRange(i + 1, 7).setValue(newVal);
          return sendJSON({ success: true, blocked: newVal });
        }
      }
      return sendJSON({ success: false, message: "User not found" });
    }

    if (type === "forceLogout") {
      const { email, token, targetEmail } = e.parameter;
      if (!isAdmin(email, token)) return sendJSON({ success: false, message: "Unauthorized" });
      const rows = sheets.verify.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === targetEmail) {
          sheets.verify.getRange(i + 1, 5).setValue("");
          sheets.verify.getRange(i + 1, 8).setValue("No");
          return sendJSON({ success: true, message: "User logged out" });
        }
      }
      return sendJSON({ success: false, message: "User not found" });
    }

    if (type === "addMCQ") {
      const { email, token, subject, college, qnumber, question, optionA, optionB, optionC, optionD, answer, image, explanation, correctText, fbA, fbB, fbC, fbD } = e.parameter;
      if (!isAdmin(email, token)) return sendJSON({ success: false, message: "Unauthorized" });
      sheets.mcq.appendRow([subject, college, qnumber, question, optionA, optionB, optionC, optionD, answer, image || "", explanation || "", correctText || "", fbA || "", fbB || "", fbC || "", fbD || ""]);
      return sendJSON({ success: true, message: "MCQ Added" });
    }

    if (type === "deleteMCQ") {
      const { email, token, qnumber } = e.parameter;
      if (!isAdmin(email, token)) return sendJSON({ success: false, message: "Unauthorized" });
      const data = sheets.mcq.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][2] == qnumber) { sheets.mcq.deleteRow(i + 1); return sendJSON({ success: true, message: "MCQ Deleted" }); }
      }
      return sendJSON({ success: false, message: "MCQ not found" });
    }

    if (type === "addAdminUser") {
      const { email, token, newEmail, fullName, role, password } = e.parameter;
      if (!isSuperAdmin(email)) return sendJSON({ success: false, message: "Super Admin only." });
      sheets.admin.appendRow([newEmail, fullName, "Active", role, "", password, new Date()]);
      // Add to verify sheet with consistent columns
      sheets.verify.appendRow([newEmail, "", "Active", "", "", "", 0, "No", "", role, fullName, "", "", "", password, "", "", "", generateReferralCode(newEmail), 0]);
      return sendJSON({ success: true, message: "Admin Added" });
    }

    return sendJSON({ success: false, message: "Invalid Request" });

  } catch (err) {
    return sendJSON({ success: false, error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function logActivity(sheet, email, action, token, ip, location) {
  if (sheet) sheet.appendRow([new Date(), email, action, ip || "", location || "", token || ""]);
}
