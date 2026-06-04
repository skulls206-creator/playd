package com.playd.music.data

import android.content.Context
import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface TrackDao {

    @Query("SELECT * FROM tracks ORDER BY title ASC")
    fun getAllByTitle(): Flow<List<Track>>

    @Query("SELECT * FROM tracks ORDER BY artist ASC")
    fun getAllByArtist(): Flow<List<Track>>

    @Query("SELECT * FROM tracks ORDER BY album ASC")
    fun getAllByAlbum(): Flow<List<Track>>

    @Query("SELECT * FROM tracks ORDER BY dateAdded DESC")
    fun getAllByDateAdded(): Flow<List<Track>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(tracks: List<Track>)

    @Delete
    suspend fun delete(track: Track)

    @Query("DELETE FROM tracks")
    suspend fun deleteAll()

    @Query(
        """SELECT * FROM tracks 
           WHERE title LIKE '%' || :query || '%' 
           OR artist LIKE '%' || :query || '%' 
           OR album LIKE '%' || :query || '%' 
           ORDER BY title ASC"""
    )
    fun search(query: String): Flow<List<Track>>

    @Query("SELECT * FROM tracks WHERE isFavorite = 1 ORDER BY title ASC")
    fun getFavorites(): Flow<List<Track>>

    @Query("UPDATE tracks SET isFavorite = :isFavorite WHERE id = :id")
    suspend fun setFavorite(id: Long, isFavorite: Boolean)
}

@Database(entities = [Track::class], version = 1, exportSchema = false)
abstract class MusicDatabase : RoomDatabase() {

    abstract fun trackDao(): TrackDao

    companion object {

        @Volatile
        private var INSTANCE: MusicDatabase? = null

        fun getDatabase(context: Context): MusicDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    MusicDatabase::class.java,
                    "playd_database"
                ).build()
                INSTANCE = instance
                instance
            }
        }
    }
}
