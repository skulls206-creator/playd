package com.playd.music.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "tracks")
data class Track(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val title: String,
    val artist: String,
    val album: String,
    val duration: Long,        // milliseconds
    val filePath: String,      // content URI string
    val albumArtUri: String?,  // content URI for album art
    val dateAdded: Long,
    val fileSize: Long = 0,
    val mimeType: String = "",
    val trackNumber: Int = 0,
    val year: Int = 0,
    val isFavorite: Boolean = false,
)
