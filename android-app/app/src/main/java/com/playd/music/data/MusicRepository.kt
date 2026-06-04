package com.playd.music.data

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext

enum class SortOrder {
    TITLE, ARTIST, ALBUM, DATE_ADDED
}

class MusicRepository(
    private val context: Context,
    private val dao: TrackDao
) {

    companion object {

        @Volatile
        private var INSTANCE: MusicRepository? = null

        fun getInstance(context: Context): MusicRepository {
            return INSTANCE ?: synchronized(this) {
                val db = MusicDatabase.getDatabase(context)
                INSTANCE ?: MusicRepository(
                    context.applicationContext,
                    db.trackDao()
                ).also { INSTANCE = it }
            }
        }
    }

    fun getAllTracks(sortOrder: SortOrder): Flow<List<Track>> {
        return when (sortOrder) {
            SortOrder.TITLE -> dao.getAllByTitle()
            SortOrder.ARTIST -> dao.getAllByArtist()
            SortOrder.ALBUM -> dao.getAllByAlbum()
            SortOrder.DATE_ADDED -> dao.getAllByDateAdded()
        }
    }

    fun searchTracks(query: String): Flow<List<Track>> {
        return dao.search(query)
    }

    fun getFavorites(): Flow<List<Track>> = dao.getFavorites()

    suspend fun toggleFavorite(track: Track) {
        dao.setFavorite(track.id, !track.isFavorite)
    }

    suspend fun scanMediaStore(): Int {
        return withContext(Dispatchers.IO) {
            val tracks = queryMediaStore()
            dao.deleteAll()
            dao.insertAll(tracks)
            tracks.size
        }
    }

    @Suppress("LongMethod")
    private fun queryMediaStore(): List<Track> {
        val tracks = mutableListOf<Track>()
        val collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)

        val projection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.DATA,
            MediaStore.Audio.Media.ALBUM_ID,
            MediaStore.Audio.Media.DATE_ADDED,
            MediaStore.Audio.Media.SIZE,
            MediaStore.Audio.Media.MIME_TYPE,
            MediaStore.Audio.Media.TRACK,
            MediaStore.Audio.Media.YEAR
        )

        val selection = "${MediaStore.Audio.Media.IS_MUSIC} != 0"
        val sortOrder = "${MediaStore.Audio.Media.TITLE} ASC"

        context.contentResolver.query(
            collection,
            projection,
            selection,
            null,
            sortOrder
        )?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
            val titleCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
            val artistCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
            val albumCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
            val durationCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
            val albumIdCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID)
            val dateAddedCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED)
            val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)
            val mimeCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE)
            val trackCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TRACK)
            val yearCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.YEAR)

            while (cursor.moveToNext()) {
                val id = cursor.getLong(idCol)
                val contentUri = ContentUris.withAppendedId(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id
                ).toString()

                val albumId = cursor.getLong(albumIdCol)
                val artUri = ContentUris.withAppendedId(
                    Uri.parse("content://media/external/audio/albumart"),
                    albumId
                ).toString()

                tracks.add(
                    Track(
                        title = cursor.getString(titleCol) ?: "Unknown",
                        artist = cursor.getString(artistCol) ?: "Unknown Artist",
                        album = cursor.getString(albumCol) ?: "Unknown Album",
                        duration = cursor.getLong(durationCol),
                        filePath = contentUri,
                        albumArtUri = artUri,
                        dateAdded = cursor.getLong(dateAddedCol),
                        fileSize = cursor.getLong(sizeCol),
                        mimeType = cursor.getString(mimeCol) ?: "",
                        trackNumber = cursor.getInt(trackCol),
                        year = cursor.getInt(yearCol)
                    )
                )
            }
        }

        return tracks
    }
}
