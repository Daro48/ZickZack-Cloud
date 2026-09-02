CREATE DATABASE IF NOT EXISTS cloud;
USE cloud;

CREATE TABLE users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    recovery_code VARCHAR(16) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_token CHAR(64) NOT NULL UNIQUE,
    user_id INT UNSIGNED NOT NULL,
    expires_at DATETIME NOT NULL,
    ip_address VARCHAR(45),
    user_agent VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,
    INDEX idx_sessions_expires_at (expires_at)
);

CREATE TABLE login_attempts (
    ip_address VARCHAR(45) NOT NULL PRIMARY KEY,
    failed_count INT UNSIGNED NOT NULL DEFAULT 0,
    locked_until DATETIME NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE photos (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(255) NOT NULL,
    stored_path VARCHAR(512) NOT NULL,
    folder VARCHAR(64) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,
    INDEX idx_photos_user_created (user_id, created_at),
    INDEX idx_photos_user_folder_created (user_id, folder, created_at),
    UNIQUE KEY uq_photos_user_stored_name (user_id, stored_name)
);

CREATE TABLE videos (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(255) NOT NULL,
    stored_path VARCHAR(512) NOT NULL,
    folder VARCHAR(64) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL,
    duration_seconds INT UNSIGNED NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,
    INDEX idx_videos_user_created (user_id, created_at),
    INDEX idx_videos_user_folder_created (user_id, folder, created_at),
    UNIQUE KEY uq_videos_user_stored_name (user_id, stored_name)
);

CREATE TABLE shares (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    owner_id INT UNSIGNED NOT NULL,
    kind ENUM('folder', 'items') NOT NULL,
    folder VARCHAR(64) NULL,
    note VARCHAR(280) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id)
        REFERENCES users(id)
        ON DELETE CASCADE,
    INDEX idx_shares_owner_created (owner_id, created_at),
    INDEX idx_shares_owner_folder (owner_id, kind, folder)
);

CREATE TABLE share_recipients (
    share_id BIGINT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (share_id, user_id),
    FOREIGN KEY (share_id)
        REFERENCES shares(id)
        ON DELETE CASCADE,
    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,
    INDEX idx_share_recipients_user (user_id)
);

CREATE TABLE share_items (
    share_id BIGINT UNSIGNED NOT NULL,
    media_type ENUM('photo', 'video') NOT NULL,
    media_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (share_id, media_type, media_id),
    FOREIGN KEY (share_id)
        REFERENCES shares(id)
        ON DELETE CASCADE,
    INDEX idx_share_items_media (media_type, media_id)
);

CREATE TABLE share_links (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    share_id BIGINT UNSIGNED NOT NULL,
    token CHAR(32) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (share_id)
        REFERENCES shares(id)
        ON DELETE CASCADE,
    INDEX idx_share_links_expires (expires_at)
);

CREATE TABLE notifications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    share_id BIGINT UNSIGNED NULL,
    message VARCHAR(255) NOT NULL,
    read_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,
    FOREIGN KEY (share_id)
        REFERENCES shares(id)
        ON DELETE CASCADE,
    INDEX idx_notifications_user_created (user_id, created_at),
    INDEX idx_notifications_user_unread (user_id, read_at)
);
