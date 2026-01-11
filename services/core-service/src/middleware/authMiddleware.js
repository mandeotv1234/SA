const jwt = require('jsonwebtoken');

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1W4HxmDaLrRtv2RNYFaQ
f9/th0sm4BOPLf08FFy6IfNANlV81519VvKOYvIfn998kWRR/M/Gm/veNiP909fM
E+RazuVy08xq0e6ndlFNWlQZpppEFl0lbWAt2cqUjlmYqhTBXAahvErLcxN1sI0t
3MWgptdcFF9Zin2mMaQiCa3N7kAO+nJA1KFVi9vGxzt5CeNbMXS1v8Ie3N72LY0Y
udM/wRM85AJHlt2Gfoyc/uWkcu3xGVSu3wkfhjVapyNhOJk6KFj33ewrc93bcOv/
khSpKfAEMP2eYW3hv27H/cV+ecQmAXHzxc6umdH65T2i/uXuCOMVp7Xc6fV6uoqe
wwIDAQAB
-----END PUBLIC KEY-----`;

function requireVIP(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        // If Kong didn't block it (e.g. internal network), we must block it.
        return res.status(401).json({ error: 'Missing Authorization header' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Invalid Authorization header format' });
    }

    try {
        const decoded = jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'] });
        if (decoded.is_vip) {
            req.user = decoded;
            next();
        } else {
            return res.status(403).json({ error: 'VIP access required' });
        }
    } catch (err) {
        console.error('JWT Verification failed:', err.message);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

module.exports = { requireVIP };
