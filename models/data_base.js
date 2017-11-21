Post = new Mongo.Collection('posts');

Post.publish = function(message, name) {
 var params = {
  message: message,
  name: name,
  time: new Date(),
  userId: Meteor.userId()
 };
 this.insert(params);
 winston.info("Post.publish: ", params);
};


Post.list = function(userIds) {
 return this.find(
  {userId: {"$in": userIds}},
  {sort: {time: -1, name: 1}}
 );
};