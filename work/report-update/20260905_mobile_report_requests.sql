CREATE TABLE IF NOT EXISTS mobile_report_requests (
  request_id CHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  response_json LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL
) ENGINE=InnoDB;
