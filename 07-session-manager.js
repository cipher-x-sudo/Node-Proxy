function getSessionId(req) {
    return (req.query && req.query.sid) || req.headers['x-session-id'] || (req.cookies && req.cookies.sid) || Math.random().toString(36).substring(2);
}
 
module.exports = {
    getSessionId
}; 