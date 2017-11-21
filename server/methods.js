Meteor.methods({
  followUser: function(friendId) {
    Friendship.follow(friendId);
   },

  unfollowUser: function(friendId) {
    Friendship.unfollow(friendId);
  },

  profileUpdate: function(name, about) {
    Meteor.users.update(
      {_id: this.userId},
      {$set: {
       "profile.name": name,
       "profile.about": about
        }
      }
    );

    Post.update(
      {userId: this.userId},
      {$set: {
        name: name
      }},
      {multi: true}
    );
  },

  addPost: function(message, name){
    Post.publish(message, name);

  },
  
  removeTimeline: function(id){
    Post.remove({_id: id, userId: this.userId});
  }


})